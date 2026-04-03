#![allow(unused)]
//! Immutable compiled command schema and read-only introspection views.
//!
//! This module contains two closely related layers:
//!
//! - internal frozen schema data structures used by the runtime
//! - public lightweight reference wrappers for introspection
//!
//! The design goals are:
//!
//! - immutable runtime representation
//! - cheap [`Command`] cloning via [`Arc`]
//! - compact storage via dense IDs
//! - fewer heap allocations by packing variable-length data into global arrays
//! - deterministic ordering for help, docs, and tests
//! - pleasant read-only APIs for tooling and introspection
//!
//! # Two important concepts
//!
//! A compiled CLI schema has both:
//!
//! 1. canonical definitions
//!    - what an arg is
//!    - how it is named
//!    - how it is displayed
//!    - how values are described
//!
//! 2. command-local effective views
//!    - which args are active in a command
//!    - inherited globals
//!    - local lookup tables
//!    - local validation masks
//!
//! This module models both. Canonical definitions live in global arrays inside
//! [`CompiledSchema`], while each compiled command stores its own effective
//! local view via [`CommandArg`] records.
//!
//! # Packed variable-length storage
//!
//! To reduce allocator pressure and improve locality, variable-length command,
//! arg, group, and value-spec data is stored in large packed backing arrays
//! inside [`CompiledSchema`]. Individual compiled records then point at their
//! corresponding sub-slices using [`SliceRange`].
//!
//! This preserves the same public API while substantially reducing the number of
//! small heap allocations compared with storing a separate `Box<[T]>` in every
//! compiled record.
//!
//! # Public usage
//!
//! End users typically interact with:
//!
//! - [`Command`]
//! - [`CommandRef`]
//! - [`ArgRef`]
//! - [`GroupRef`]
//! - [`ValueSpecRef`]
//!
//! Example:
//!
//! ```rust,ignore
//! let command: Command = builder.build()?;
//! let root = command.as_ref();
//!
//! println!("command: {}", root.name());
//!
//! for arg in root.args() {
//!     println!("arg: {}", arg.id_string());
//! }
//! ```

use std::ffi::OsString;
use std::fmt;
use std::sync::Arc;

use crate::HelpRenderer as _;
use crate::bitmask::FrozenBitMask;
use crate::builder::{
    ArgActionKind, ArgKind, Arity, ErasedValueValidator, GroupRelation, ParserKind, Validator,
    ValueHint,
};
use crate::ids::{ArgId, CommandId, GroupId, LocalArgIndex, Symbol, ValueSpecId};
use crate::runtime_error::ArgvSnapshot;
use crate::string_pool::StringPool;

/// Threshold at which tiny lookup tables switch from linear scan to binary
/// search.
///
/// For very small slices, a straight linear scan is often faster in practice
/// than the extra branching and indirection of binary search.
const SMALL_LOOKUP_LINEAR_SCAN_LIMIT: usize = 8;

/// Immutable compiled runtime command handle.
///
/// `Command` is the main runtime object produced by schema compilation. It is:
///
/// - immutable
/// - cheap to clone
/// - thread-safe if its internals are
/// - ready for parsing, help, and completions immediately
///
/// Internally it points at a shared frozen schema and stores the root command
/// ID.
///
/// # Examples
///
/// ```rust,ignore
/// let command = builder.build()?;
///
/// println!("root command: {}", command.name());
///
/// let root = command.as_ref();
/// for sub in root.subcommands() {
///     println!("subcommand: {}", sub.name());
/// }
/// # Ok::<(), crate::BuildError>(())
/// ```
#[derive(Clone)]
pub struct Command {
    pub(crate) schema: Arc<CompiledSchema>,
    pub(crate) root: CommandId,
}

impl Command {
    /// Borrow a read-only view over the root command.
    ///
    /// This is the main entry point for schema introspection.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let root = command.as_ref();
    /// assert_eq!(root.name(), "acme");
    /// ```
    #[must_use]
    pub fn as_ref(&self) -> CommandRef<'_> {
        CommandRef { schema: &self.schema, id: self.root }
    }

    /// Return the root command ID.
    #[must_use]
    pub fn id(&self) -> CommandId {
        self.root
    }

    /// Return the root command name.
    #[must_use]
    pub fn name(&self) -> &str {
        self.as_ref().name()
    }

    /// Parse arguments from the current process environment.
    ///
    /// This is the primary high-level runtime entry point.
    ///
    /// # Errors
    ///
    /// Returns [`crate::RuntimeError`] if normalization or parsing fails.
    pub fn parse_env(&self) -> Result<crate::Matches, crate::RuntimeError> {
        self.parse_from(std::env::args_os())
    }

    /// Parse arguments from an argv-like iterator.
    ///
    /// The first item is interpreted as the program name, just like a real
    /// process argv.
    ///
    /// # Errors
    ///
    /// Returns [`crate::RuntimeError`] if parsing fails.
    pub fn parse_from<I, T>(&self, iter: I) -> Result<crate::Matches, crate::RuntimeError>
    where
        I: IntoIterator<Item = T>,
        T: Into<OsString>,
    {
        let (collected, snapshot) = collect_argv(iter);
        let output = self.parse_collected(collected)?;
        self.finish_matches(output, snapshot)
    }

    /// Parse arguments from the current process environment, printing rich
    /// diagnostics and exiting with status code 2 on failure.
    #[must_use]
    pub fn parse_env_or_exit(&self) -> crate::Matches {
        self.parse_from_or_exit(std::env::args_os())
    }

    /// Parse arguments from an argv-like iterator, printing rich diagnostics and
    /// exiting with status code 2 on failure.
    #[must_use]
    pub fn parse_from_or_exit<I, T>(&self, iter: I) -> crate::Matches
    where
        I: IntoIterator<Item = T>,
        T: Into<OsString>,
    {
        let (collected, snapshot) = collect_argv(iter);

        match self.parse_collected(collected) {
            Ok(output) => match self.finish_matches(output, snapshot) {
                Ok(matches) => matches,
                Err(crate::RuntimeError::HelpRequested { command }) => {
                    let command_ref = self
                        .command_ref_by_id(command)
                        .expect("help command id must exist in schema");

                    let options = crate::help::HelpOptions::default();
                    let doc = crate::help::build_help_doc(command_ref, &options);
                    let text = crate::help::DefaultHelpRenderer
                        .render_doc(&doc, &options)
                        .expect("help rendering should succeed");

                    println!("{text}");
                    std::process::exit(0);
                }
                Err(err) => {
                    err.eprint().expect("failed to print runtime diagnostic");
                    std::process::exit(2);
                }
            },
            Err(err) => {
                err.eprint_with_argv(snapshot).expect("failed to print runtime diagnostic");
                std::process::exit(2);
            }
        }
    }

    /// Parse already-collected argv into the raw parse output.
    fn parse_collected(
        &self,
        collected: Vec<OsString>,
    ) -> Result<crate::parse::ParseOutput, crate::RuntimeError> {
        let argv = crate::parse::Argv::from_argv(collected);
        let tokenized = crate::parse::tokenize_argv(argv);
        crate::parse::parse_command(self, tokenized).map_err(crate::RuntimeError::from)
    }

    /// Finalize parse output into runtime matches, handling `--help` requests.
    fn finish_matches(
        &self,
        output: crate::parse::ParseOutput,
        snapshot: ArgvSnapshot,
    ) -> Result<crate::Matches, crate::RuntimeError> {
        let matches = crate::Matches::new(self.clone(), output, snapshot);

        if let Some(command) = matches.help_command() {
            return Err(crate::RuntimeError::HelpRequested { command: command.id() });
        }

        Ok(matches)
    }

    /// Borrow a command view directly by its compiled ID.
    fn command_ref_by_id(&self, id: CommandId) -> Option<CommandRef<'_>> {
        self.schema.commands.get(id.index()).map(|_| CommandRef { schema: &self.schema, id })
    }
}

impl fmt::Debug for Command {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let root = self.schema.command(self.root);
        f.debug_struct("Command")
            .field("id", &self.root)
            .field("name", &self.schema.symbol(root.name))
            .finish()
    }
}

/// Collect argv into owned storage and build the diagnostic snapshot once.
fn collect_argv<I, T>(iter: I) -> (Vec<OsString>, ArgvSnapshot)
where
    I: IntoIterator<Item = T>,
    T: Into<OsString>,
{
    let collected = iter.into_iter().map(Into::into).collect::<Vec<_>>();
    let snapshot = ArgvSnapshot::from_argv(collected.iter().cloned());
    (collected, snapshot)
}

/// Compact range into a packed backing slice.
///
/// Many compiled records contain variable-length associated data such as aliases,
/// members, possible values, or lookup tables. Rather than storing a separate
/// allocation per record, the data is packed globally inside [`CompiledSchema`]
/// and referenced by one of these ranges.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub(crate) struct SliceRange {
    start: usize,
    len: usize,
}

impl SliceRange {
    /// Construct a range from a start offset and length.
    #[must_use]
    pub(crate) const fn new(start: usize, len: usize) -> Self {
        Self { start, len }
    }

    /// Return the first index of the range.
    #[must_use]
    pub(crate) const fn start(self) -> usize {
        self.start
    }

    /// Return the number of elements in the range.
    #[must_use]
    pub(crate) const fn len(self) -> usize {
        self.len
    }

    /// Return whether the range is empty.
    #[must_use]
    pub(crate) const fn is_empty(self) -> bool {
        self.len == 0
    }

    /// Return the exclusive end index of the range.
    #[must_use]
    pub(crate) const fn end(self) -> usize {
        self.start + self.len
    }

    /// Borrow this range from a backing slice.
    #[must_use]
    pub(crate) fn get<T>(self, values: &[T]) -> &[T] {
        &values[self.start..self.end()]
    }
}

impl From<std::ops::Range<usize>> for SliceRange {
    fn from(range: std::ops::Range<usize>) -> Self {
        Self::new(range.start, range.end.saturating_sub(range.start))
    }
}

/// Immutable command-local arg lookup by canonical arg ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ArgLocalLookup {
    pub(crate) arg: ArgId,
    pub(crate) local: LocalArgIndex,
}

/// Immutable compiled storage shared by all [`Command`] handles.
///
/// Variable-length data is stored in packed backing arrays and referenced by
/// [`SliceRange`] from the canonical records.
#[derive(Debug)]
pub(crate) struct CompiledSchema {
    pub(crate) strings: StringPool,

    pub(crate) commands: Box<[CompiledCommand]>,
    pub(crate) args: Box<[CompiledArg]>,
    pub(crate) groups: Box<[CompiledGroup]>,
    pub(crate) value_specs: Box<[CompiledValueSpec]>,

    pub(crate) command_aliases: Box<[Symbol]>,
    pub(crate) command_subcommands: Box<[CommandId]>,
    pub(crate) command_groups: Box<[GroupId]>,
    pub(crate) command_args: Box<[CommandArg]>,
    pub(crate) command_positionals: Box<[LocalArgIndex]>,
    pub(crate) command_visible_items: Box<[HelpItem]>,
    pub(crate) command_arg_locals_by_id: Box<[ArgLocalLookup]>,

    pub(crate) lookup_longs: Box<[LongLookup]>,
    pub(crate) lookup_shorts: Box<[ShortLookup]>,
    pub(crate) lookup_subcommands: Box<[SubcommandLookup]>,

    pub(crate) arg_aliases: Box<[CompiledArgAlias]>,
    pub(crate) group_members: Box<[ArgId]>,

    pub(crate) value_possible_values: Box<[CompiledPossibleValue]>,
    pub(crate) value_validators: Box<[Validator]>,
    pub(crate) value_custom_validators: Box<[Arc<dyn ErasedValueValidator>]>,
}

impl CompiledSchema {
    #[inline]
    pub(crate) fn command(&self, id: CommandId) -> &CompiledCommand {
        &self.commands[id.index()]
    }

    #[inline]
    pub(crate) fn arg(&self, id: ArgId) -> &CompiledArg {
        &self.args[id.index()]
    }

    #[inline]
    pub(crate) fn group(&self, id: GroupId) -> &CompiledGroup {
        &self.groups[id.index()]
    }

    #[inline]
    pub(crate) fn value_spec(&self, id: ValueSpecId) -> &CompiledValueSpec {
        &self.value_specs[id.index()]
    }

    #[inline]
    pub(crate) fn symbol(&self, symbol: Symbol) -> &str {
        self.strings.get(symbol)
    }
}

/// Canonical compiled command record.
#[derive(Debug)]
pub(crate) struct CompiledCommand {
    pub(crate) parent: Option<CommandId>,
    pub(crate) name: Symbol,
    pub(crate) about: Option<Symbol>,
    pub(crate) long_about: Option<Symbol>,

    pub(crate) aliases: SliceRange,
    pub(crate) subcommands: SliceRange,
    pub(crate) groups: SliceRange,
    pub(crate) args: SliceRange,
    pub(crate) positionals: SliceRange,
    pub(crate) local_by_arg: SliceRange,
    pub(crate) visible_items: SliceRange,

    pub(crate) lookup: CommandLookup,
    pub(crate) required_mask: FrozenBitMask,
}

impl CompiledCommand {
    #[inline]
    fn aliases_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [Symbol] {
        self.aliases.get(&schema.command_aliases)
    }

    #[inline]
    fn subcommands_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [CommandId] {
        self.subcommands.get(&schema.command_subcommands)
    }

    #[inline]
    fn groups_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [GroupId] {
        self.groups.get(&schema.command_groups)
    }

    #[inline]
    fn args_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [CommandArg] {
        self.args.get(&schema.command_args)
    }

    #[inline]
    fn positionals_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [LocalArgIndex] {
        self.positionals.get(&schema.command_positionals)
    }

    #[inline]
    fn visible_items_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [HelpItem] {
        self.visible_items.get(&schema.command_visible_items)
    }

    #[inline]
    fn local_by_arg_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [ArgLocalLookup] {
        self.local_by_arg.get(&schema.command_arg_locals_by_id)
    }
}

/// Effective command-local arg entry.
///
/// This is the command-specific lowered view used for parsing and validation.
#[derive(Debug)]
pub(crate) struct CommandArg {
    pub(crate) arg: ArgId,
    pub(crate) local: LocalArgIndex,
    pub(crate) inherited: bool,
    pub(crate) conflicts: FrozenBitMask,
    pub(crate) requires: FrozenBitMask,
    pub(crate) groups: SliceRange,
}

impl CommandArg {
    #[inline]
    fn groups_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [GroupId] {
        self.groups.get(&schema.command_groups)
    }
}

/// Canonical compiled arg definition.
#[derive(Debug)]
pub(crate) struct CompiledArg {
    pub(crate) declared_on: CommandId,
    pub(crate) id: Symbol,

    pub(crate) kind: ArgKind,
    pub(crate) action: ArgActionKind,
    pub(crate) value: Option<ValueSpecId>,

    pub(crate) declared_global: bool,
    pub(crate) required: bool,
    pub(crate) short: Option<char>,
    pub(crate) long: Option<Symbol>,
    pub(crate) env: Option<Symbol>,
    pub(crate) position: Option<u16>,

    pub(crate) aliases: SliceRange,
    pub(crate) help: CompiledHelpMeta,
    pub(crate) visibility: CompiledVisibility,
}

impl CompiledArg {
    #[inline]
    fn aliases_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [CompiledArgAlias] {
        self.aliases.get(&schema.arg_aliases)
    }
}

/// Canonical compiled group definition.
#[derive(Debug)]
pub(crate) struct CompiledGroup {
    pub(crate) declared_on: CommandId,
    pub(crate) id: Symbol,
    pub(crate) members: SliceRange,
    pub(crate) required: bool,
    pub(crate) multiple: bool,
    pub(crate) relation: GroupRelation,
    pub(crate) help: Option<Symbol>,
}

impl CompiledGroup {
    #[inline]
    fn members_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [ArgId] {
        self.members.get(&schema.group_members)
    }
}

/// Frozen compiled value specification.
#[derive(Debug)]
pub(crate) struct CompiledValueSpec {
    pub(crate) parser: ParserKind,
    pub(crate) arity: Arity,
    pub(crate) hint: ValueHint,
    pub(crate) possible_values: SliceRange,
    pub(crate) default: Option<CompiledDefaultValue>,
    pub(crate) expected: &'static str,
    pub(crate) validators: SliceRange,
    pub(crate) custom_validators: SliceRange,
}

impl CompiledValueSpec {
    #[inline]
    fn possible_values_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [CompiledPossibleValue] {
        self.possible_values.get(&schema.value_possible_values)
    }

    #[inline]
    fn validators_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [Validator] {
        self.validators.get(&schema.value_validators)
    }

    #[inline]
    fn custom_validators_slice<'a>(
        &self,
        schema: &'a CompiledSchema,
    ) -> &'a [Arc<dyn ErasedValueValidator>] {
        self.custom_validators.get(&schema.value_custom_validators)
    }
}

/// Compiled arg alias entry.
#[derive(Clone, Debug)]
pub(crate) struct CompiledArgAlias {
    pub(crate) name: Symbol,
    pub(crate) hidden: bool,
}

/// Compiled possible value entry.
#[derive(Clone, Debug)]
pub(crate) struct CompiledPossibleValue {
    pub(crate) value: Symbol,
    pub(crate) help: Option<Symbol>,
    pub(crate) hidden: bool,
}

/// Compiled default value entry.
#[derive(Clone, Debug)]
pub(crate) enum CompiledDefaultValue {
    String(Symbol),
    Display(Symbol),
}

/// Frozen help metadata.
#[derive(Clone, Debug)]
pub(crate) struct CompiledHelpMeta {
    pub(crate) heading: Option<Symbol>,
    pub(crate) help: Option<Symbol>,
    pub(crate) long_help: Option<Symbol>,
    pub(crate) value_name: Option<Symbol>,
}

/// Frozen visibility metadata.
#[derive(Clone, Debug)]
pub(crate) enum CompiledVisibility {
    Normal,
    Hidden,
    Deprecated { note: Option<Symbol> },
}

/// Immutable per-command lookup ranges.
///
/// Long lookup includes canonical long names and long aliases.
#[derive(Debug)]
pub(crate) struct CommandLookup {
    pub(crate) longs: SliceRange,
    pub(crate) shorts: SliceRange,
    pub(crate) subcommands: SliceRange,
}

impl CommandLookup {
    #[inline]
    fn longs_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [LongLookup] {
        self.longs.get(&schema.lookup_longs)
    }

    #[inline]
    fn shorts_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [ShortLookup] {
        self.shorts.get(&schema.lookup_shorts)
    }

    #[inline]
    fn subcommands_slice<'a>(&self, schema: &'a CompiledSchema) -> &'a [SubcommandLookup] {
        self.subcommands.get(&schema.lookup_subcommands)
    }
}

/// Lookup entry for a long option or alias.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LongLookup {
    pub(crate) name: Symbol,
    pub(crate) local: LocalArgIndex,
}

/// Lookup entry for a short option.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShortLookup {
    pub(crate) name: char,
    pub(crate) local: LocalArgIndex,
}

/// Lookup entry for a subcommand name or alias.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SubcommandLookup {
    pub(crate) name: Symbol,
    pub(crate) command: CommandId,
}

/// Deterministic command help ordering.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HelpItem {
    Arg(LocalArgIndex),
    Subcommand(CommandId),
    Heading(Symbol),
}

/// Internal resolved command-local arg view.
///
/// This private helper allows the parser and validator to carry both the local
/// slot and the canonical arg without needing an extra reverse lookup.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LocalArgRef<'a> {
    pub(crate) local: LocalArgIndex,
    pub(crate) arg: ArgRef<'a>,
}

/// Read-only borrowed view over a compiled command.
///
/// `CommandRef` is cheap to copy and provides ergonomic access to command
/// metadata and its effective view.
///
/// # Examples
///
/// ```rust,ignore
/// let root = command.as_ref();
///
/// println!("name = {}", root.name());
/// println!("subcommands = {}", root.subcommands().len());
/// ```
#[derive(Clone, Copy)]
pub struct CommandRef<'a> {
    pub(crate) schema: &'a CompiledSchema,
    pub(crate) id: CommandId,
}

impl fmt::Debug for CommandRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommandRef").field("id", &self.id).field("name", &self.name()).finish()
    }
}

impl<'a> CommandRef<'a> {
    /// Return this command's ID.
    #[must_use]
    pub fn id(self) -> CommandId {
        self.id
    }

    /// Return this command's name.
    #[must_use]
    pub fn name(self) -> &'a str {
        self.schema.symbol(self.data().name)
    }

    /// Return the short description, if present.
    #[must_use]
    pub fn about(self) -> Option<&'a str> {
        self.data().about.map(|s| self.schema.symbol(s))
    }

    /// Return the long description, if present.
    #[must_use]
    pub fn long_about(self) -> Option<&'a str> {
        self.data().long_about.map(|s| self.schema.symbol(s))
    }

    /// Iterate over this command's aliases.
    #[must_use]
    pub fn aliases(self) -> impl ExactSizeIterator<Item = &'a str> + 'a {
        self.data().aliases_slice(self.schema).iter().copied().map(|sym| self.schema.symbol(sym))
    }

    /// Return the parent command, if this is a subcommand.
    #[must_use]
    pub fn parent(self) -> Option<Self> {
        self.data().parent.map(|id| Self { schema: self.schema, id })
    }

    /// Return `true` if this command has no parent.
    #[must_use]
    pub fn is_root(self) -> bool {
        self.data().parent.is_none()
    }

    /// Return `true` if this command has no subcommands.
    #[must_use]
    pub fn is_leaf(self) -> bool {
        self.data().subcommands_slice(self.schema).is_empty()
    }

    /// Return the number of direct subcommands.
    #[must_use]
    pub fn subcommand_count(self) -> usize {
        self.data().subcommands_slice(self.schema).len()
    }

    /// Iterate over direct subcommands.
    #[must_use]
    pub fn subcommands(self) -> impl ExactSizeIterator<Item = CommandRef<'a>> + 'a {
        self.data()
            .subcommands_slice(self.schema)
            .iter()
            .copied()
            .map(|id| CommandRef { schema: self.schema, id })
    }

    /// Iterate over effective groups visible in this command.
    ///
    /// This includes groups declared locally and any inherited groups that were
    /// made effective for this command by compilation.
    #[must_use]
    pub fn groups(self) -> impl ExactSizeIterator<Item = GroupRef<'a>> + 'a {
        self.data()
            .groups_slice(self.schema)
            .iter()
            .copied()
            .map(|id| GroupRef { schema: self.schema, id })
    }

    /// Iterate over effective arguments visible in this command.
    ///
    /// This includes locally declared args and inherited globals.
    #[must_use]
    pub fn args(self) -> impl ExactSizeIterator<Item = ArgRef<'a>> + 'a {
        self.data()
            .args_slice(self.schema)
            .iter()
            .map(|entry| ArgRef { schema: self.schema, id: entry.arg })
    }

    /// Return the number of effective arguments in this command view.
    #[must_use]
    pub fn arg_count(self) -> usize {
        self.data().args_slice(self.schema).len()
    }

    /// Iterate over local arg slots together with the canonical arg and whether
    /// the arg is inherited.
    ///
    /// The [`LocalArgIndex`] is the command-local slot used by validation masks
    /// and later parser state.
    #[must_use]
    pub fn local_args(
        self,
    ) -> impl ExactSizeIterator<Item = (LocalArgIndex, ArgRef<'a>, bool)> + 'a {
        self.data().args_slice(self.schema).iter().map(|entry| {
            (entry.local, ArgRef { schema: self.schema, id: entry.arg }, entry.inherited)
        })
    }

    /// Iterate over positional args in effective positional order.
    #[must_use]
    pub fn positionals(self) -> impl ExactSizeIterator<Item = ArgRef<'a>> + 'a {
        let data = self.data();
        let args = data.args_slice(self.schema);

        data.positionals_slice(self.schema).iter().map(move |local| {
            let entry = &args[local.index()];
            ArgRef { schema: self.schema, id: entry.arg }
        })
    }

    /// Iterate over precomputed visible help items in deterministic order.
    ///
    /// This is the canonical ordering later used by help renderers and docs.
    #[must_use]
    pub fn help_items(self) -> impl ExactSizeIterator<Item = HelpItemRef<'a>> + 'a {
        let data = self.data();
        let args = data.args_slice(self.schema);

        data.visible_items_slice(self.schema).iter().map(move |item| match *item {
            HelpItem::Arg(local) => {
                let entry = &args[local.index()];
                HelpItemRef::Arg(ArgRef { schema: self.schema, id: entry.arg })
            }
            HelpItem::Subcommand(id) => {
                HelpItemRef::Subcommand(CommandRef { schema: self.schema, id })
            }
            HelpItem::Heading(sym) => HelpItemRef::Heading(self.schema.symbol(sym)),
        })
    }

    /// Look up a long option or long alias by its spelling without leading `--`.
    ///
    /// Returns the effective arg visible in this command, if any.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(LookupRef::Arg(arg)) = root.lookup_long("verbose") {
    ///     println!("matched {}", arg.id_string());
    /// }
    /// ```
    #[must_use]
    pub fn lookup_long(self, name: &str) -> Option<LookupRef<'a>> {
        self.lookup_long_local(name).map(|resolved| LookupRef::Arg(resolved.arg))
    }

    /// Look up a short option by its character.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(LookupRef::Arg(arg)) = root.lookup_short('v') {
    ///     println!("matched {}", arg.id_string());
    /// }
    /// ```
    #[must_use]
    pub fn lookup_short(self, name: char) -> Option<LookupRef<'a>> {
        self.lookup_short_local(name).map(|resolved| LookupRef::Arg(resolved.arg))
    }

    /// Look up a subcommand name or alias.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(LookupRef::Subcommand(cmd)) = root.lookup_subcommand("build") {
    ///     println!("subcommand {}", cmd.name());
    /// }
    /// ```
    #[must_use]
    pub fn lookup_subcommand(self, name: &str) -> Option<LookupRef<'a>> {
        let data = self.data();
        let subcommands = data.lookup.subcommands_slice(self.schema);

        let found = if subcommands.len() <= SMALL_LOOKUP_LINEAR_SCAN_LIMIT {
            subcommands.iter().find(|entry| self.schema.symbol(entry.name) == name)
        } else {
            subcommands
                .binary_search_by(|entry| self.schema.symbol(entry.name).cmp(name))
                .ok()
                .map(|index| &subcommands[index])
        };

        found.map(|entry| {
            LookupRef::Subcommand(CommandRef { schema: self.schema, id: entry.command })
        })
    }

    /// Look up a long option and return both the local slot and canonical arg.
    ///
    /// This internal helper exists for hot parser paths that need the local slot
    /// immediately and should avoid an extra reverse lookup by arg ID.
    #[inline]
    pub(crate) fn lookup_long_local(self, name: &str) -> Option<LocalArgRef<'a>> {
        let data = self.data();
        let longs = data.lookup.longs_slice(self.schema);
        let args = data.args_slice(self.schema);

        let found = if longs.len() <= SMALL_LOOKUP_LINEAR_SCAN_LIMIT {
            longs.iter().find(|entry| self.schema.symbol(entry.name) == name)
        } else {
            longs
                .binary_search_by(|entry| self.schema.symbol(entry.name).cmp(name))
                .ok()
                .map(|index| &longs[index])
        };

        found.map(|entry| {
            let local = entry.local;
            let arg = ArgRef { schema: self.schema, id: args[local.index()].arg };

            LocalArgRef { local, arg }
        })
    }

    /// Look up a short option and return both the local slot and canonical arg.
    ///
    /// This internal helper exists for hot parser paths that need the local slot
    /// immediately and should avoid an extra reverse lookup by arg ID.
    #[inline]
    pub(crate) fn lookup_short_local(self, name: char) -> Option<LocalArgRef<'a>> {
        let data = self.data();
        let shorts = data.lookup.shorts_slice(self.schema);
        let args = data.args_slice(self.schema);

        let found = if shorts.len() <= SMALL_LOOKUP_LINEAR_SCAN_LIMIT {
            shorts.iter().find(|entry| entry.name == name)
        } else {
            shorts.binary_search_by_key(&name, |entry| entry.name).ok().map(|index| &shorts[index])
        };

        found.map(|entry| {
            let local = entry.local;
            let arg = ArgRef { schema: self.schema, id: args[local.index()].arg };

            LocalArgRef { local, arg }
        })
    }

    #[inline]
    pub(crate) fn local_arg_entry(self, local: LocalArgIndex) -> &'a CommandArg {
        &self.data().args_slice(self.schema)[local.index()]
    }

    #[inline]
    pub(crate) fn required_mask(self) -> &'a FrozenBitMask {
        &self.data().required_mask
    }

    #[inline]
    pub(crate) fn local_arg_by_id(self, id: ArgId) -> Option<LocalArgIndex> {
        let entries = self.data().local_by_arg_slice(self.schema);

        let found = if entries.len() <= SMALL_LOOKUP_LINEAR_SCAN_LIMIT {
            entries.iter().find(|entry| entry.arg == id)
        } else {
            let target = id.index();
            entries
                .binary_search_by_key(&target, |entry| entry.arg.index())
                .ok()
                .map(|index| &entries[index])
        };

        found.map(|entry| entry.local)
    }

    fn data(self) -> &'a CompiledCommand {
        self.schema.command(self.id)
    }
}

/// Read-only borrowed view over a canonical compiled arg.
///
/// `ArgRef` exposes canonical arg metadata. It is not command-local by itself;
/// command-local state such as inheritance and local validation masks lives in
/// the containing command's effective view.
///
/// # Examples
///
/// ```rust,ignore
/// for arg in root.args() {
///     println!("arg {}", arg.id_string());
///
///     if let Some(long) = arg.long() {
///         println!("  --{long}");
///     }
/// }
/// ```
#[derive(Clone, Copy)]
pub struct ArgRef<'a> {
    pub(crate) schema: &'a CompiledSchema,
    pub(crate) id: ArgId,
}

impl fmt::Debug for ArgRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ArgRef").field("id", &self.id).field("name", &self.id_string()).finish()
    }
}

impl<'a> ArgRef<'a> {
    /// Return this arg's canonical ID.
    #[must_use]
    pub fn id(self) -> ArgId {
        self.id
    }

    /// Return the canonical arg identifier string.
    ///
    /// This is the stable schema-level arg ID, not necessarily the displayed
    /// option spelling.
    #[must_use]
    pub fn id_string(self) -> &'a str {
        self.schema.symbol(self.data().id)
    }

    /// Return the arg kind.
    #[must_use]
    pub fn kind(self) -> ArgKind {
        self.data().kind
    }

    /// Return `true` if this arg was declared as global.
    #[must_use]
    pub fn declared_global(self) -> bool {
        self.data().declared_global
    }

    /// Return the short option name, if any.
    #[must_use]
    pub fn short(self) -> Option<char> {
        self.data().short
    }

    /// Return the long option name, if any.
    #[must_use]
    pub fn long(self) -> Option<&'a str> {
        self.data().long.map(|s| self.schema.symbol(s))
    }

    /// Iterate over long aliases for this arg.
    #[must_use]
    pub fn aliases(self) -> impl ExactSizeIterator<Item = ArgAliasRef<'a>> + 'a {
        self.data().aliases_slice(self.schema).iter().map(|alias| ArgAliasRef {
            schema: self.schema,
            name: alias.name,
            hidden: alias.hidden,
        })
    }

    /// Return the semantic action of this arg.
    #[must_use]
    pub fn action(self) -> ArgActionKind {
        self.data().action
    }

    /// Return the environment variable source, if any.
    #[must_use]
    pub fn env(self) -> Option<&'a str> {
        self.data().env.map(|s| self.schema.symbol(s))
    }

    /// Return the arg's help metadata.
    #[must_use]
    pub fn help(self) -> HelpMetaRef<'a> {
        let help = &self.data().help;
        HelpMetaRef {
            schema: self.schema,
            heading: help.heading,
            help: help.help,
            long_help: help.long_help,
            value_name: help.value_name,
        }
    }

    /// Return visibility metadata for this arg.
    #[must_use]
    pub fn visibility(self) -> VisibilityRef<'a> {
        match &self.data().visibility {
            CompiledVisibility::Normal => VisibilityRef::Normal,
            CompiledVisibility::Hidden => VisibilityRef::Hidden,
            CompiledVisibility::Deprecated { note } => {
                VisibilityRef::Deprecated { note: note.map(|sym| self.schema.symbol(sym)) }
            }
        }
    }

    /// Return `true` if this arg is required.
    #[must_use]
    pub fn required(self) -> bool {
        self.data().required
    }

    /// Return the command on which this arg was originally declared.
    #[must_use]
    pub fn declared_on(self) -> CommandRef<'a> {
        CommandRef { schema: self.schema, id: self.data().declared_on }
    }

    /// Return the explicit positional index, if any.
    ///
    /// This is only meaningful for positional args.
    #[must_use]
    pub fn position(self) -> Option<u16> {
        self.data().position
    }

    /// Return the value specification, if this arg accepts values.
    #[must_use]
    pub fn value_spec(self) -> Option<ValueSpecRef<'a>> {
        self.data().value.map(|id| ValueSpecRef { schema: self.schema, id })
    }

    #[inline]
    pub(crate) fn takes_value(self) -> bool {
        self.data().value.is_some()
    }

    #[inline]
    pub(crate) fn validators(self) -> &'a [Validator] {
        match self.data().value {
            Some(id) => self.schema.value_spec(id).validators_slice(self.schema),
            None => &[],
        }
    }

    #[inline]
    pub(crate) fn custom_validators(self) -> &'a [Arc<dyn ErasedValueValidator>] {
        match self.data().value {
            Some(id) => self.schema.value_spec(id).custom_validators_slice(self.schema),
            None => &[],
        }
    }

    fn data(self) -> &'a CompiledArg {
        self.schema.arg(self.id)
    }
}

/// Read-only borrowed view over a canonical compiled group.
#[derive(Clone, Copy)]
pub struct GroupRef<'a> {
    pub(crate) schema: &'a CompiledSchema,
    pub(crate) id: GroupId,
}

impl fmt::Debug for GroupRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GroupRef").field("id", &self.id).field("name", &self.id_string()).finish()
    }
}

impl<'a> GroupRef<'a> {
    /// Return this group's canonical ID.
    #[must_use]
    pub fn id(self) -> GroupId {
        self.id
    }

    /// Return the group identifier string.
    #[must_use]
    pub fn id_string(self) -> &'a str {
        self.schema.symbol(self.data().id)
    }

    /// Return the command on which this group was originally declared.
    #[must_use]
    pub fn declared_on(self) -> CommandRef<'a> {
        CommandRef { schema: self.schema, id: self.data().declared_on }
    }

    /// Iterate over the group's canonical member args.
    #[must_use]
    pub fn members(self) -> impl ExactSizeIterator<Item = ArgRef<'a>> + 'a {
        self.data()
            .members_slice(self.schema)
            .iter()
            .copied()
            .map(|id| ArgRef { schema: self.schema, id })
    }

    /// Return `true` if the group is required.
    #[must_use]
    pub fn required(self) -> bool {
        self.data().required
    }

    /// Return `true` if multiple members may appear.
    #[must_use]
    pub fn multiple(self) -> bool {
        self.data().multiple
    }

    /// Return the group's relation mode.
    #[must_use]
    pub fn relation(self) -> GroupRelation {
        self.data().relation
    }

    /// Return the group's help text, if any.
    #[must_use]
    pub fn help(self) -> Option<&'a str> {
        self.data().help.map(|s| self.schema.symbol(s))
    }

    fn data(self) -> &'a CompiledGroup {
        self.schema.group(self.id)
    }
}

/// Read-only borrowed view over a canonical compiled value specification.
#[derive(Clone, Copy)]
pub struct ValueSpecRef<'a> {
    pub(crate) schema: &'a CompiledSchema,
    pub(crate) id: ValueSpecId,
}

impl fmt::Debug for ValueSpecRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ValueSpecRef")
            .field("id", &self.id)
            .field("expected", &self.expected())
            .finish()
    }
}

impl<'a> ValueSpecRef<'a> {
    /// Return this value spec's canonical ID.
    #[must_use]
    pub fn id(self) -> ValueSpecId {
        self.id
    }

    /// Return the parser kind metadata.
    #[must_use]
    pub fn parser_kind(self) -> &'a ParserKind {
        &self.data().parser
    }

    /// Return the accepted value arity.
    #[must_use]
    pub fn arity(self) -> Arity {
        self.data().arity
    }

    /// Return the UI and completion hint.
    #[must_use]
    pub fn hint(self) -> ValueHint {
        self.data().hint
    }

    /// Return the user-facing expected value description.
    #[must_use]
    pub fn expected(self) -> &'static str {
        self.data().expected
    }

    /// Iterate over declared possible values.
    #[must_use]
    pub fn possible_values(self) -> impl ExactSizeIterator<Item = PossibleValueRef<'a>> + 'a {
        self.data().possible_values_slice(self.schema).iter().map(|value| PossibleValueRef {
            schema: self.schema,
            value: value.value,
            help: value.help,
            hidden: value.hidden,
        })
    }

    /// Return default value metadata, if present.
    #[must_use]
    pub fn default(self) -> Option<DefaultValueRef<'a>> {
        self.data().default.as_ref().map(|default| match default {
            CompiledDefaultValue::String(sym) => DefaultValueRef::String(self.schema.symbol(*sym)),
            CompiledDefaultValue::Display(sym) => {
                DefaultValueRef::Display(self.schema.symbol(*sym))
            }
        })
    }

    /// Return semantic validators attached to this value spec.
    #[must_use]
    pub fn validators(self) -> &'a [Validator] {
        self.data().validators_slice(self.schema)
    }

    /// Return custom value validators attached to this value spec.
    #[must_use]
    pub fn custom_validators(self) -> &'a [Arc<dyn ErasedValueValidator>] {
        self.data().custom_validators_slice(self.schema)
    }

    fn data(self) -> &'a CompiledValueSpec {
        self.schema.value_spec(self.id)
    }
}

/// Read-only arg alias metadata.
#[derive(Clone, Copy, Debug)]
pub struct ArgAliasRef<'a> {
    schema: &'a CompiledSchema,
    name: Symbol,
    hidden: bool,
}

impl<'a> ArgAliasRef<'a> {
    /// Return the alias spelling.
    #[must_use]
    pub fn name(self) -> &'a str {
        self.schema.symbol(self.name)
    }

    /// Return `true` if the alias is hidden from user-facing help.
    #[must_use]
    pub fn hidden(self) -> bool {
        self.hidden
    }
}

/// Read-only borrowed help metadata view.
#[derive(Clone, Copy, Debug)]
pub struct HelpMetaRef<'a> {
    schema: &'a CompiledSchema,
    heading: Option<Symbol>,
    help: Option<Symbol>,
    long_help: Option<Symbol>,
    value_name: Option<Symbol>,
}

impl<'a> HelpMetaRef<'a> {
    /// Return the help heading, if any.
    #[must_use]
    pub fn heading(self) -> Option<&'a str> {
        self.heading.map(|s| self.schema.symbol(s))
    }

    /// Return the short help text, if any.
    #[must_use]
    pub fn help(self) -> Option<&'a str> {
        self.help.map(|s| self.schema.symbol(s))
    }

    /// Return the long help text, if any.
    #[must_use]
    pub fn long_help(self) -> Option<&'a str> {
        self.long_help.map(|s| self.schema.symbol(s))
    }

    /// Return the display value name, if any.
    #[must_use]
    pub fn value_name(self) -> Option<&'a str> {
        self.value_name.map(|s| self.schema.symbol(s))
    }
}

/// Public borrowed visibility metadata.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum VisibilityRef<'a> {
    /// Visible normally.
    Normal,
    /// Hidden from user-facing presentation.
    Hidden,
    /// Deprecated with an optional note.
    Deprecated {
        /// Optional deprecation note.
        note: Option<&'a str>,
    },
}

/// Public borrowed possible value metadata.
#[derive(Clone, Copy, Debug)]
pub struct PossibleValueRef<'a> {
    schema: &'a CompiledSchema,
    value: Symbol,
    help: Option<Symbol>,
    hidden: bool,
}

impl<'a> PossibleValueRef<'a> {
    /// Return the canonical value spelling.
    #[must_use]
    pub fn value(self) -> &'a str {
        self.schema.symbol(self.value)
    }

    /// Return the help text for this value, if any.
    #[must_use]
    pub fn help(self) -> Option<&'a str> {
        self.help.map(|s| self.schema.symbol(s))
    }

    /// Return `true` if this possible value is hidden.
    #[must_use]
    pub fn hidden(self) -> bool {
        self.hidden
    }
}

/// Public borrowed default value metadata.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum DefaultValueRef<'a> {
    /// Canonical string default.
    String(&'a str),
    /// Display-only default.
    Display(&'a str),
}

/// Public borrowed help item view.
///
/// This enum provides a stable, renderer-friendly view of precomputed help
/// layout ordering.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum HelpItemRef<'a> {
    /// A visible argument entry.
    Arg(ArgRef<'a>),
    /// A visible subcommand entry.
    Subcommand(CommandRef<'a>),
    /// A visible heading separator.
    Heading(&'a str),
}

/// Result of a command-local lookup.
///
/// Long and short lookups return args. Subcommand lookups return subcommands.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum LookupRef<'a> {
    /// Matched arg.
    Arg(ArgRef<'a>),
    /// Matched subcommand.
    Subcommand(CommandRef<'a>),
}
