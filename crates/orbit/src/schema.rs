#![allow(unused)]
//! Immutable compiled command schema and read-only introspection views.
//!
//! This module contains two layers:
//!
//! - internal frozen schema data structures used by the runtime
//! - public lightweight reference wrappers for introspection
//!
//! The design goals are:
//!
//! - immutable runtime representation
//! - cheap `Command` cloning via `Arc`
//! - compact storage via dense IDs and boxed slices
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
//! [`CompiledSchema`], while each compiled command stores its own effective local
//! view via [`CommandArg`] records.
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

use std::fmt;
use std::sync::Arc;

use crate::HelpRenderer as _;
use crate::bitmask::FrozenBitMask;
use crate::builder::{
    ArgAction, ArgActionKind, ArgKind, Arity, ErasedValueValidator, GroupRelation, ParserKind,
    Validator, ValueHint,
};
use crate::ids::{ArgId, CommandId, GroupId, LocalArgIndex, Symbol, ValueSpecId};
use crate::runtime_error::ArgvSnapshot;
use crate::string_pool::StringPool;

/// Immutable compiled runtime command handle.
///
/// `Command` is the main runtime object produced by schema compilation. It is:
///
/// - immutable
/// - cheap to clone
/// - thread-safe if its internals are
/// - ready for parsing/help/completions immediately
///
/// Internally it points at a shared frozen schema and stores the root command ID.
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
    /// Returns[`crate::RuntimeError`] if parsing fails.
    pub fn parse_from<I, T>(&self, iter: I) -> Result<crate::Matches, crate::RuntimeError>
    where
        I: IntoIterator<Item = T>,
        T: Into<std::ffi::OsString>,
    {
        let collected = iter.into_iter().map(Into::into).collect::<Vec<_>>();
        let snapshot = ArgvSnapshot::from_argv(collected.iter().cloned());
        let argv = crate::parse::Argv::from_argv(collected);

        let tokenized = crate::parse::tokenize_argv(argv);
        let output = crate::parse::parse_command(self, tokenized)?;
        let matches = crate::Matches::new(self.clone(), output, snapshot);

        if let Some(command) = matches.help_command() {
            return Err(crate::RuntimeError::HelpRequested { command: command.id() });
        }

        Ok(matches)
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
        T: Into<std::ffi::OsString>,
    {
        let collected = iter.into_iter().map(Into::into).collect::<Vec<_>>();
        let snapshot = ArgvSnapshot::from_argv(collected.iter().cloned());

        match self.parse_from(collected) {
            Ok(matches) => matches,
            Err(crate::RuntimeError::HelpRequested { command }) => {
                let command_ref = find_command_by_id(self.as_ref(), command)
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
                err.eprint_with_argv(snapshot).expect("failed to print runtime diagnostic");
                std::process::exit(2);
            }
        }
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

/// Frozen compiled schema storage.
///
/// This is the central immutable backing store shared by all `Command` handles.
#[derive(Debug)]
pub(crate) struct CompiledSchema {
    pub(crate) strings: StringPool,
    pub(crate) commands: Box<[CompiledCommand]>,
    pub(crate) args: Box<[CompiledArg]>,
    pub(crate) groups: Box<[CompiledGroup]>,
    pub(crate) value_specs: Box<[CompiledValueSpec]>,
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
    pub(crate) aliases: Box<[Symbol]>,
    pub(crate) subcommands: Box<[CommandId]>,
    pub(crate) groups: Box<[GroupId]>,
    pub(crate) args: Box<[CommandArg]>,
    pub(crate) positionals: Box<[LocalArgIndex]>,
    pub(crate) lookup: CommandLookup,
    pub(crate) required_mask: FrozenBitMask,
    pub(crate) visible_items: Box<[HelpItem]>,
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
    pub(crate) groups: Box<[GroupId]>,
}

/// Canonical compiled arg definition.
#[derive(Debug)]
pub(crate) struct CompiledArg {
    pub(crate) declared_on: CommandId,
    pub(crate) id: Symbol,
    pub(crate) kind: ArgKind,
    pub(crate) declared_global: bool,
    pub(crate) short: Option<char>,
    pub(crate) long: Option<Symbol>,
    pub(crate) aliases: Box<[CompiledArgAlias]>,
    pub(crate) action: ArgActionKind,
    pub(crate) value: Option<ValueSpecId>,
    pub(crate) env: Option<Symbol>,
    pub(crate) help: CompiledHelpMeta,
    pub(crate) visibility: CompiledVisibility,
    pub(crate) position: Option<u16>,
}

/// Canonical compiled group definition.
#[derive(Debug)]
pub(crate) struct CompiledGroup {
    pub(crate) declared_on: CommandId,
    pub(crate) id: Symbol,
    pub(crate) members: Box<[ArgId]>,
    pub(crate) required: bool,
    pub(crate) multiple: bool,
    pub(crate) relation: GroupRelation,
    pub(crate) help: Option<Symbol>,
}

/// Frozen compiled value specification.
#[derive(Debug)]
pub(crate) struct CompiledValueSpec {
    pub(crate) parser: ParserKind,
    pub(crate) arity: Arity,
    pub(crate) hint: ValueHint,
    pub(crate) possible_values: Box<[CompiledPossibleValue]>,
    pub(crate) default: Option<CompiledDefaultValue>,
    pub(crate) expected: &'static str,
    pub(crate) validators: Box<[Validator]>,
    pub(crate) custom_validators: Box<[Arc<dyn ErasedValueValidator>]>,
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

/// Immutable per-command lookup tables.
///
/// Long lookup includes canonical long names and long aliases.
#[derive(Debug)]
pub(crate) struct CommandLookup {
    pub(crate) longs: Box<[LongLookup]>,
    pub(crate) shorts: Box<[ShortLookup]>,
    pub(crate) subcommands: Box<[SubcommandLookup]>,
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
        self.data().aliases.iter().copied().map(|sym| self.schema.symbol(sym))
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
        self.data().subcommands.is_empty()
    }

    /// Return the number of direct subcommands.
    #[must_use]
    pub fn subcommand_count(self) -> usize {
        self.data().subcommands.len()
    }

    /// Iterate over direct subcommands.
    #[must_use]
    pub fn subcommands(self) -> impl ExactSizeIterator<Item = CommandRef<'a>> + 'a {
        self.data().subcommands.iter().copied().map(|id| CommandRef { schema: self.schema, id })
    }

    /// Iterate over effective groups visible in this command.
    ///
    /// This includes groups declared locally and any inherited groups that were
    /// made effective for this command by compilation.
    #[must_use]
    pub fn groups(self) -> impl ExactSizeIterator<Item = GroupRef<'a>> + 'a {
        self.data().groups.iter().copied().map(|id| GroupRef { schema: self.schema, id })
    }

    /// Iterate over effective arguments visible in this command.
    ///
    /// This includes locally declared args and inherited globals.
    #[must_use]
    pub fn args(self) -> impl ExactSizeIterator<Item = ArgRef<'a>> + 'a {
        self.data().args.iter().map(|entry| ArgRef { schema: self.schema, id: entry.arg })
    }

    /// Return the number of effective arguments in this command view.
    #[must_use]
    pub fn arg_count(self) -> usize {
        self.data().args.len()
    }

    /// Iterate over local arg slots together with the canonical arg and whether
    /// the arg is inherited.
    ///
    /// The `LocalArgIndex` is the command-local slot used by validation masks and
    /// later parser state.
    #[must_use]
    pub fn local_args(
        self,
    ) -> impl ExactSizeIterator<Item = (LocalArgIndex, ArgRef<'a>, bool)> + 'a {
        self.data().args.iter().map(|entry| {
            (entry.local, ArgRef { schema: self.schema, id: entry.arg }, entry.inherited)
        })
    }

    /// Iterate over positional args in effective positional order.
    #[must_use]
    pub fn positionals(self) -> impl ExactSizeIterator<Item = ArgRef<'a>> + 'a {
        let data = self.data();
        data.positionals.iter().map(move |local| {
            let entry = &data.args[local.index()];
            ArgRef { schema: self.schema, id: entry.arg }
        })
    }

    /// Iterate over precomputed visible help items in deterministic order.
    ///
    /// This is the canonical ordering later used by help renderers and docs.
    #[must_use]
    pub fn help_items(self) -> impl ExactSizeIterator<Item = HelpItemRef<'a>> + 'a {
        let data = self.data();
        data.visible_items.iter().map(move |item| match *item {
            HelpItem::Arg(local) => {
                let entry = &data.args[local.index()];
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
        let data = self.data();
        let longs = &data.lookup.longs;

        let found = if longs.len() <= 8 {
            longs.iter().find(|entry| self.schema.symbol(entry.name) == name)
        } else {
            longs
                .binary_search_by(|entry| self.schema.symbol(entry.name).cmp(name))
                .ok()
                .map(|index| &longs[index])
        };

        found.map(|entry| {
            let local = &data.args[entry.local.index()];
            LookupRef::Arg(ArgRef { schema: self.schema, id: local.arg })
        })
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
        let data = self.data();
        let shorts = &data.lookup.shorts;

        let found = if shorts.len() <= 8 {
            shorts.iter().find(|entry| entry.name == name)
        } else {
            shorts.binary_search_by_key(&name, |entry| entry.name).ok().map(|index| &shorts[index])
        };

        found.map(|entry| {
            let local = &data.args[entry.local.index()];
            LookupRef::Arg(ArgRef { schema: self.schema, id: local.arg })
        })
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
        let subcommands = &data.lookup.subcommands;

        let found = if subcommands.len() <= 8 {
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

    #[inline]
    pub(crate) fn local_arg_entry(self, local: LocalArgIndex) -> &'a CommandArg {
        &self.data().args[local.index()]
    }

    #[inline]
    pub(crate) fn required_mask(self) -> &'a FrozenBitMask {
        &self.data().required_mask
    }

    #[inline]
    pub(crate) fn local_arg_by_id(self, id: ArgId) -> Option<LocalArgIndex> {
        self.data().args.iter().find_map(|entry| (entry.arg == id).then_some(entry.local))
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
        self.data().aliases.iter().map(|alias| ArgAliasRef {
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
            Some(id) => &self.schema.value_spec(id).validators,
            None => &[],
        }
    }

    #[inline]
    pub(crate) fn custom_validators(self) -> &'a [Arc<dyn ErasedValueValidator>] {
        match self.data().value {
            Some(id) => &self.schema.value_spec(id).custom_validators,
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
        self.data().members.iter().copied().map(|id| ArgRef { schema: self.schema, id })
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

    /// Return the UI/completion hint.
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
        self.data().possible_values.iter().map(|value| PossibleValueRef {
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
        &self.data().validators
    }

    #[must_use]
    pub fn custom_validators(self) -> &'a [Arc<dyn ErasedValueValidator>] {
        &self.data().custom_validators
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
/// Long/short lookups return args. Subcommand lookups return subcommands.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum LookupRef<'a> {
    /// Matched arg.
    Arg(ArgRef<'a>),
    /// Matched subcommand.
    Subcommand(CommandRef<'a>),
}

fn find_command_by_id(command: CommandRef<'_>, id: CommandId) -> Option<CommandRef<'_>> {
    if command.id() == id {
        return Some(command);
    }

    for sub in command.subcommands() {
        if let Some(found) = find_command_by_id(sub, id) {
            return Some(found);
        }
    }

    None
}
