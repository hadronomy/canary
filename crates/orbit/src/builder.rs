//! Authoring-time builder API for command schemas.
//!
//! This module defines the mutable, ergonomic front-end used to construct a CLI
//! schema before compilation into the immutable runtime [`crate::Command`].
//!
//! The builders here are intended for:
//!
//! - dynamic or runtime-defined CLIs
//! - derive-generated schema construction
//! - tests and schema fixtures
//! - advanced programmatic schema authoring
//!
//! The model is:
//!
//! - mutable while authoring
//! - validated and lowered by compilation
//! - immutable once built
//!
//! # Typical usage
//!
//! ```rust,ignore
//! use crate::builder::{
//!     ArgAction, ArgBuilder, CommandBuilder, ParserKind, ValueHint,
//!     ValueSpecBuilder,
//! };
//!
//! let command = CommandBuilder::new("acme")
//!     .about("Example application")
//!     .arg(
//!         ArgBuilder::flag("verbose")
//!             .short('v')
//!             .long("verbose")
//!             .action(ArgAction::Count)
//!             .help("Increase verbosity"),
//!     )
//!     .arg(
//!         ArgBuilder::option("config")
//!             .long("config")
//!             .value(
//!                 ValueSpecBuilder::new(ParserKind::PathBuf)
//!                     .hint(ValueHint::FilePath),
//!             )
//!             .help("Path to config file"),
//!     )
//!     .build()?;
//! # Ok::<(), crate::BuildError>(())
//! ```
//!
//! # Design notes
//!
//! These builders intentionally preserve author intent, including:
//!
//! - declaration order
//! - aliases
//! - help metadata
//! - relation declarations
//! - groups
//!
//! The compiler is responsible for:
//!
//! - lowering to dense IDs
//! - inheriting globals
//! - building command-local effective views
//! - validating duplicates and relations
//! - freezing into immutable runtime schema

use std::fmt;
use std::sync::Arc;

use crate::compiler::compile_command;
use crate::{BuildError, Command};

/// Builder for a command schema.
///
/// A command may contain:
///
/// - metadata such as name and help text
/// - direct subcommands
/// - directly declared args
/// - directly declared groups
///
/// This is the primary authoring entry point.
///
/// # Examples
///
/// ```rust,ignore
/// let builder = CommandBuilder::new("acme")
///     .about("Example application")
///     .subcommand(CommandBuilder::new("build"))
///     .subcommand(CommandBuilder::new("test"));
/// ```
#[derive(Clone, Debug, Default)]
pub struct CommandBuilder {
    pub(crate) name: String,
    pub(crate) about: Option<String>,
    pub(crate) long_about: Option<String>,
    pub(crate) aliases: Vec<String>,
    pub(crate) subcommands: Vec<CommandBuilder>,
    pub(crate) args: Vec<ArgBuilder>,
    pub(crate) groups: Vec<GroupBuilder>,
}

impl CommandBuilder {
    /// Create a new command builder with the given name.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let cmd = CommandBuilder::new("acme");
    /// ```
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Self::default() }
    }

    /// Compile this builder into an immutable runtime [`crate::Command`].
    ///
    /// # Errors
    ///
    /// Returns [`crate::BuildError`] if the schema is invalid, for example due
    /// to duplicate names, invalid relations, or positional layout problems.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let command = CommandBuilder::new("acme").build()?;
    /// # Ok::<(), crate::BuildError>(())
    /// ```
    pub fn build(self) -> Result<Command, BuildError> {
        compile_command(self)
    }

    /// Set the short description.
    #[must_use]
    pub fn about(mut self, text: impl Into<String>) -> Self {
        self.about = Some(text.into());
        self
    }

    /// Set the long description.
    #[must_use]
    pub fn long_about(mut self, text: impl Into<String>) -> Self {
        self.long_about = Some(text.into());
        self
    }

    /// Add a command alias.
    #[must_use]
    pub fn alias(mut self, alias: impl Into<String>) -> Self {
        self.aliases.push(alias.into());
        self
    }

    /// Add multiple command aliases.
    #[must_use]
    pub fn aliases<I, S>(mut self, aliases: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.aliases.extend(aliases.into_iter().map(Into::into));
        self
    }

    /// Add a subcommand.
    #[must_use]
    pub fn subcommand(mut self, command: CommandBuilder) -> Self {
        self.subcommands.push(command);
        self
    }

    /// Add multiple subcommands.
    #[must_use]
    pub fn subcommands<I>(mut self, commands: I) -> Self
    where
        I: IntoIterator<Item = CommandBuilder>,
    {
        self.subcommands.extend(commands);
        self
    }

    /// Add a directly declared arg.
    #[must_use]
    pub fn arg(mut self, arg: ArgBuilder) -> Self {
        self.args.push(arg);
        self
    }

    /// Add multiple directly declared args.
    #[must_use]
    pub fn args<I>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = ArgBuilder>,
    {
        self.args.extend(args);
        self
    }

    /// Add a directly declared group.
    #[must_use]
    pub fn group(mut self, group: GroupBuilder) -> Self {
        self.groups.push(group);
        self
    }

    /// Add multiple directly declared groups.
    #[must_use]
    pub fn groups<I>(mut self, groups: I) -> Self
    where
        I: IntoIterator<Item = GroupBuilder>,
    {
        self.groups.extend(groups);
        self
    }

    /// Return this command's name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Return the short description, if any.
    #[must_use]
    pub fn about_ref(&self) -> Option<&str> {
        self.about.as_deref()
    }

    /// Return the long description, if any.
    #[must_use]
    pub fn long_about_ref(&self) -> Option<&str> {
        self.long_about.as_deref()
    }

    /// Return the declared aliases.
    #[must_use]
    pub fn aliases_ref(&self) -> &[String] {
        &self.aliases
    }

    /// Return directly declared subcommands.
    #[must_use]
    pub fn subcommands_ref(&self) -> &[CommandBuilder] {
        &self.subcommands
    }

    /// Return directly declared args.
    #[must_use]
    pub fn args_ref(&self) -> &[ArgBuilder] {
        &self.args
    }

    /// Return directly declared groups.
    #[must_use]
    pub fn groups_ref(&self) -> &[GroupBuilder] {
        &self.groups
    }

    /// Return `true` if the command has no subcommands, args, or groups.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.subcommands.is_empty() && self.args.is_empty() && self.groups.is_empty()
    }
}

/// Builder for an argument definition.
///
/// Args are canonical schema declarations that may later become effective in
/// multiple command views if marked global.
///
/// # Kinds
///
/// An arg has an [`ArgKind`]:
///
/// - [`ArgKind::Flag`]
/// - [`ArgKind::Option`]
/// - [`ArgKind::Positional`]
///
/// # Relations
///
/// An arg may declare:
///
/// - `requires(...)`
/// - `conflicts_with(...)`
/// - membership in groups via `in_group(...)`
///
/// These are symbolic authoring-time declarations. They are resolved and lowered
/// by the compiler.
///
/// # Examples
///
/// ```rust,ignore
/// let verbose = ArgBuilder::flag("verbose")
///     .short('v')
///     .long("verbose")
///     .help("Increase verbosity");
///
/// let config = ArgBuilder::option("config")
///     .long("config")
///     .value_name("PATH")
///     .help("Path to configuration file");
/// ```
#[derive(Clone, Debug)]
pub struct ArgBuilder {
    pub(crate) id: String,
    pub(crate) kind: ArgKind,
    pub(crate) declared_global: bool,
    pub(crate) short: Option<char>,
    pub(crate) long: Option<String>,
    pub(crate) aliases: Vec<ArgAlias>,
    pub(crate) action: ArgAction,
    pub(crate) value: Option<ValueSpecBuilder>,
    pub(crate) env: Option<String>,
    pub(crate) help: HelpMeta,
    pub(crate) visibility: Visibility,
    pub(crate) position: Option<u16>,
    pub(crate) requires: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) groups: Vec<String>,
}

impl ArgBuilder {
    /// Create a new flag arg.
    ///
    /// Flags default to [`ArgAction::SetTrue`] and do not carry a value spec.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let verbose = ArgBuilder::flag("verbose")
    ///     .short('v')
    ///     .long("verbose");
    /// ```
    #[must_use]
    pub fn flag(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            kind: ArgKind::Flag,
            declared_global: false,
            short: None,
            long: None,
            aliases: Vec::new(),
            action: ArgAction::SetTrue,
            value: None,
            env: None,
            help: HelpMeta::default(),
            visibility: Visibility::Normal,
            position: None,
            requires: Vec::new(),
            conflicts: Vec::new(),
            groups: Vec::new(),
        }
    }

    /// Create a new named option arg.
    ///
    /// Options default to [`ArgAction::Set`] and a single-value string value
    /// specification.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let config = ArgBuilder::option("config").long("config");
    /// ```
    #[must_use]
    pub fn option(id: impl Into<String>) -> Self {
        Self {
            kind: ArgKind::Option,
            action: ArgAction::Set,
            value: Some(ValueSpecBuilder::default()),
            ..Self::flag(id)
        }
    }

    /// Create a new positional arg.
    ///
    /// Positionals default to [`ArgAction::Set`] and a single-value string value
    /// specification.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let input = ArgBuilder::positional("input").position(0);
    /// ```
    #[must_use]
    pub fn positional(id: impl Into<String>) -> Self {
        Self {
            kind: ArgKind::Positional,
            action: ArgAction::Set,
            value: Some(ValueSpecBuilder::default()),
            ..Self::flag(id)
        }
    }

    /// Set the short option character.
    #[must_use]
    pub fn short(mut self, short: char) -> Self {
        self.short = Some(short);
        self
    }

    /// Set the long option name without leading `--`.
    #[must_use]
    pub fn long(mut self, long: impl Into<String>) -> Self {
        self.long = Some(long.into());
        self
    }

    /// Add a visible long alias.
    #[must_use]
    pub fn alias(mut self, name: impl Into<String>) -> Self {
        self.aliases.push(ArgAlias { name: name.into(), hidden: false });
        self
    }

    /// Add a hidden long alias.
    #[must_use]
    pub fn hidden_alias(mut self, name: impl Into<String>) -> Self {
        self.aliases.push(ArgAlias { name: name.into(), hidden: true });
        self
    }

    /// Add multiple visible long aliases.
    #[must_use]
    pub fn aliases<I, S>(mut self, aliases: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.aliases
            .extend(aliases.into_iter().map(|name| ArgAlias { name: name.into(), hidden: false }));
        self
    }

    /// Set the semantic action.
    #[must_use]
    pub fn action(mut self, action: ArgAction) -> Self {
        self.action = action;
        self
    }

    /// Mark whether this arg is declared global.
    ///
    /// Global args become effective in descendant subcommands during
    /// compilation.
    #[must_use]
    pub fn global(mut self, yes: bool) -> Self {
        self.declared_global = yes;
        self
    }

    /// Replace the value specification.
    ///
    /// This is only meaningful for option and positional args.
    #[must_use]
    pub fn value(mut self, value: ValueSpecBuilder) -> Self {
        self.value = Some(value);
        self
    }

    /// Remove any value specification.
    ///
    /// This is primarily useful when constructing unusual arg shapes before
    /// validation. The compiler will reject invalid final combinations.
    #[must_use]
    pub fn no_value(mut self) -> Self {
        self.value = None;
        self
    }

    /// Set the environment variable name used as a value source.
    #[must_use]
    pub fn env(mut self, env: impl Into<String>) -> Self {
        self.env = Some(env.into());
        self
    }

    /// Set short help text.
    #[must_use]
    pub fn help(mut self, text: impl Into<String>) -> Self {
        self.help.help = Some(text.into());
        self
    }

    /// Set long help text.
    #[must_use]
    pub fn long_help(mut self, text: impl Into<String>) -> Self {
        self.help.long_help = Some(text.into());
        self
    }

    /// Set a help heading.
    #[must_use]
    pub fn heading(mut self, heading: impl Into<String>) -> Self {
        self.help.heading = Some(heading.into());
        self
    }

    /// Set the displayed value name.
    #[must_use]
    pub fn value_name(mut self, name: impl Into<String>) -> Self {
        self.help.value_name = Some(name.into());
        self
    }

    /// Replace all help metadata.
    #[must_use]
    pub fn help_meta(mut self, help: HelpMeta) -> Self {
        self.help = help;
        self
    }

    /// Set visibility metadata.
    #[must_use]
    pub fn visibility(mut self, visibility: Visibility) -> Self {
        self.visibility = visibility;
        self
    }

    /// Set the explicit positional index.
    ///
    /// This is only meaningful for positional args.
    #[must_use]
    pub fn position(mut self, position: u16) -> Self {
        self.position = Some(position);
        self
    }

    /// Declare that this arg requires another arg or group by symbolic ID.
    ///
    /// Resolution happens during compilation.
    #[must_use]
    pub fn requires(mut self, id: impl Into<String>) -> Self {
        self.requires.push(id.into());
        self
    }

    /// Declare that this arg conflicts with another arg or group by symbolic ID.
    ///
    /// Resolution happens during compilation.
    #[must_use]
    pub fn conflicts_with(mut self, id: impl Into<String>) -> Self {
        self.conflicts.push(id.into());
        self
    }

    /// Declare membership in a group by symbolic group ID.
    #[must_use]
    pub fn in_group(mut self, id: impl Into<String>) -> Self {
        self.groups.push(id.into());
        self
    }

    /// Return the canonical arg identifier.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Return the arg kind.
    #[must_use]
    pub fn kind(&self) -> ArgKind {
        self.kind
    }

    /// Return whether the arg was declared global.
    #[must_use]
    pub fn declared_global(&self) -> bool {
        self.declared_global
    }

    /// Return the short option character, if any.
    #[must_use]
    pub fn short_ref(&self) -> Option<char> {
        self.short
    }

    /// Return the long option name, if any.
    #[must_use]
    pub fn long_ref(&self) -> Option<&str> {
        self.long.as_deref()
    }

    /// Return declared aliases.
    #[must_use]
    pub fn aliases_ref(&self) -> &[ArgAlias] {
        &self.aliases
    }

    /// Return the semantic action.
    #[must_use]
    pub fn action_ref(&self) -> ArgAction {
        self.action
    }

    /// Return the value specification, if present.
    #[must_use]
    pub fn value_ref(&self) -> Option<&ValueSpecBuilder> {
        self.value.as_ref()
    }

    /// Return the environment variable name, if any.
    #[must_use]
    pub fn env_ref(&self) -> Option<&str> {
        self.env.as_deref()
    }

    /// Return help metadata.
    #[must_use]
    pub fn help_ref(&self) -> &HelpMeta {
        &self.help
    }

    /// Return visibility metadata.
    #[must_use]
    pub fn visibility_ref(&self) -> &Visibility {
        &self.visibility
    }

    /// Return the explicit positional index, if any.
    #[must_use]
    pub fn position_ref(&self) -> Option<u16> {
        self.position
    }

    /// Return symbolic requires declarations.
    #[must_use]
    pub fn requires_ref(&self) -> &[String] {
        &self.requires
    }

    /// Return symbolic conflict declarations.
    #[must_use]
    pub fn conflicts_ref(&self) -> &[String] {
        &self.conflicts
    }

    /// Return declared symbolic group memberships.
    #[must_use]
    pub fn groups_ref(&self) -> &[String] {
        &self.groups
    }
}

/// Builder for an argument group.
///
/// Groups allow schema authors to express higher-level relationships among a
/// set of args.
///
/// # Examples
///
/// ```rust,ignore
/// let output_group = GroupBuilder::new("output")
///     .member("json")
///     .member("yaml")
///     .relation(GroupRelation::OneOf)
///     .required(true);
/// ```
#[derive(Clone, Debug)]
pub struct GroupBuilder {
    pub(crate) id: String,
    pub(crate) members: Vec<String>,
    pub(crate) required: bool,
    pub(crate) multiple: bool,
    pub(crate) relation: GroupRelation,
    pub(crate) help: Option<String>,
}

impl GroupBuilder {
    /// Create a new group.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            members: Vec::new(),
            required: false,
            multiple: true,
            relation: GroupRelation::Any,
            help: None,
        }
    }

    /// Add a member arg ID.
    #[must_use]
    pub fn member(mut self, id: impl Into<String>) -> Self {
        self.members.push(id.into());
        self
    }

    /// Add multiple member arg IDs.
    #[must_use]
    pub fn members<I, S>(mut self, members: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.members.extend(members.into_iter().map(Into::into));
        self
    }

    /// Mark whether the group is required.
    #[must_use]
    pub fn required(mut self, yes: bool) -> Self {
        self.required = yes;
        self
    }

    /// Mark whether multiple members may appear.
    #[must_use]
    pub fn multiple(mut self, yes: bool) -> Self {
        self.multiple = yes;
        self
    }

    /// Set the group relation mode.
    #[must_use]
    pub fn relation(mut self, relation: GroupRelation) -> Self {
        self.relation = relation;
        self
    }

    /// Set group help text.
    #[must_use]
    pub fn help(mut self, text: impl Into<String>) -> Self {
        self.help = Some(text.into());
        self
    }

    /// Return the group identifier.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Return member arg IDs.
    #[must_use]
    pub fn members_ref(&self) -> &[String] {
        &self.members
    }

    /// Return whether the group is required.
    #[must_use]
    pub fn required_flag(&self) -> bool {
        self.required
    }

    /// Return whether multiple members may appear.
    #[must_use]
    pub fn multiple_flag(&self) -> bool {
        self.multiple
    }

    /// Return the relation mode.
    #[must_use]
    pub fn relation_kind(&self) -> GroupRelation {
        self.relation
    }

    /// Return help text, if any.
    #[must_use]
    pub fn help_ref(&self) -> Option<&str> {
        self.help.as_deref()
    }
}

/// Builder for value specification metadata.
///
/// A value spec describes how an arg conceptually accepts and presents values.
/// It does not itself perform parsing here; it only provides the metadata that
/// the compiler freezes into the schema.
///
/// # Examples
///
/// ```rust,ignore
/// let spec = ValueSpecBuilder::new(ParserKind::PathBuf)
///     .hint(ValueHint::FilePath)
///     .arity(Arity::ONE);
/// ```
#[derive(Clone)]
pub struct ValueSpecBuilder {
    pub(crate) parser: ParserKind,
    pub(crate) arity: Arity,
    pub(crate) hint: ValueHint,
    pub(crate) possible_values: Vec<PossibleValue>,
    pub(crate) default: Option<DefaultValue>,
    pub(crate) validators: Vec<Validator>,
    pub(crate) custom_validators: Vec<Arc<dyn ErasedValueValidator>>,
}

impl ValueSpecBuilder {
    /// Create a new value specification with the given parser kind.
    #[must_use]
    pub fn new(parser: ParserKind) -> Self {
        Self { parser, ..Self::default() }
    }

    /// Set the accepted arity.
    #[must_use]
    pub fn arity(mut self, arity: Arity) -> Self {
        self.arity = arity;
        self
    }

    /// Set the UI/completion hint.
    #[must_use]
    pub fn hint(mut self, hint: ValueHint) -> Self {
        self.hint = hint;
        self
    }

    /// Add a possible value.
    #[must_use]
    pub fn possible_value(mut self, value: PossibleValue) -> Self {
        self.possible_values.push(value);
        self
    }

    /// Add multiple possible values.
    #[must_use]
    pub fn possible_values<I>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = PossibleValue>,
    {
        self.possible_values.extend(values);
        self
    }

    /// Set default value metadata.
    #[must_use]
    pub fn default_value(mut self, default: DefaultValue) -> Self {
        self.default = Some(default);
        self
    }

    /// Add a semantic validator.
    ///
    /// Validators are enforced automatically by the decode layer before typed
    /// conversion.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let spec = ValueSpecBuilder::new(ParserKind::PathBuf)
    ///     .validate(Validator::Directory);
    /// ```
    #[must_use]
    pub fn validate(mut self, validator: Validator) -> Self {
        self.validators.push(validator);
        self
    }

    /// Add multiple semantic validators.
    #[must_use]
    pub fn validators<I>(mut self, validators: I) -> Self
    where
        I: IntoIterator<Item = Validator>,
    {
        self.validators.extend(validators);
        self
    }

    #[must_use]
    pub fn custom_validator<V>(mut self, validator: V) -> Self
    where
        V: ErasedValueValidator,
    {
        self.custom_validators.push(Arc::new(validator));
        self
    }

    #[must_use]
    pub fn custom_validators<I, V>(mut self, validators: I) -> Self
    where
        I: IntoIterator<Item = V>,
        V: ErasedValueValidator,
    {
        self.custom_validators
            .extend(validators.into_iter().map(|v| Arc::new(v) as Arc<dyn ErasedValueValidator>));
        self
    }

    #[must_use]
    pub fn custom_validator_arc(mut self, validator: Arc<dyn ErasedValueValidator>) -> Self {
        self.custom_validators.push(validator);
        self
    }
}

impl Default for ValueSpecBuilder {
    fn default() -> Self {
        Self {
            parser: ParserKind::String,
            arity: Arity::ONE,
            hint: ValueHint::Unknown,
            possible_values: Vec::new(),
            default: None,
            validators: Vec::new(),
            custom_validators: Vec::new(),
        }
    }
}

impl fmt::Debug for ValueSpecBuilder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ValueSpecBuilder")
            .field("parser", &self.parser)
            .field("arity", &self.arity)
            .field("hint", &self.hint)
            .field("possible_values", &self.possible_values)
            .field("default", &self.default)
            .field("validators", &self.validators)
            .finish()
    }
}

/// Alias metadata for a long arg name.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ArgAlias {
    /// Alias spelling without leading `--`.
    pub name: String,
    /// Whether the alias should be hidden from user-facing help.
    pub hidden: bool,
}

/// High-level argument kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ArgKind {
    /// Boolean-ish switch, e.g. `-v` or `--verbose`.
    Flag,
    /// Named option with one or more values, e.g. `--config path`.
    Option,
    /// Positional argument.
    Positional,
}

/// Semantic action taken by an argument.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ArgAction {
    /// Set a boolean-ish presence to true.
    SetTrue,
    /// Set a boolean-ish presence to false.
    SetFalse,
    /// Count repeated occurrences.
    Count,
    /// Set a single value.
    Set,
    /// Append multiple values.
    Append,
    /// Synthesized or built-in help action.
    Help,
    /// Synthesized or built-in version action.
    Version,
}

/// Visibility and lifecycle metadata.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Visibility {
    /// Normal visible item.
    Normal,
    /// Hidden from normal help output.
    Hidden,
    /// Deprecated item with an optional note.
    Deprecated { note: Option<String> },
}

/// Group semantics.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum GroupRelation {
    /// One or more members may appear depending on other constraints.
    Any,
    /// Exactly one member should appear.
    OneOf,
}

/// Authoring-time help metadata.
///
/// This metadata is later frozen into the compiled schema and reused by help,
/// docs, and introspection.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct HelpMeta {
    /// Optional help heading name.
    pub heading: Option<String>,
    /// Short help text.
    pub help: Option<String>,
    /// Long help text.
    pub long_help: Option<String>,
    /// Display name for a value.
    pub value_name: Option<String>,
}

/// Value parser descriptor kind.
///
/// This enum describes conceptual value parsing behavior. The actual parser
/// engine is intentionally out of scope for this module.
///
/// `Custom` stores an erased parser hook that can later be used by higher-level
/// decode layers.
#[derive(Clone)]
#[non_exhaustive]
pub enum ParserKind {
    /// Raw OS string values.
    OsString,
    /// UTF-8 string values.
    String,
    /// Filesystem paths.
    PathBuf,
    /// Enumerated values.
    ValueEnum,
    /// Custom parsing hook.
    Custom(Arc<dyn ErasedValueParser>),
}

impl fmt::Debug for ParserKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OsString => f.write_str("ParserKind::OsString"),
            Self::String => f.write_str("ParserKind::String"),
            Self::PathBuf => f.write_str("ParserKind::PathBuf"),
            Self::ValueEnum => f.write_str("ParserKind::ValueEnum"),
            Self::Custom(_) => f.write_str("ParserKind::Custom(..)"),
        }
    }
}

/// Erased custom parser hook used by schema metadata.
///
/// This trait is intentionally small. It provides a stable display-oriented type
/// name that higher-level decode machinery can use for diagnostics.
///
/// If later layers need richer parser behavior, they can build on top of this
/// trait or wrap it with additional runtime decode traits.
pub trait ErasedValueParser: Send + Sync + 'static {
    /// Stable human-readable type or parser name.
    ///
    /// This is typically used for diagnostic text such as “expected path” or
    /// “expected package specifier”.
    fn type_name(&self) -> &'static str;
}

/// Accepted value arity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Arity {
    /// Minimum number of values.
    pub min: u16,
    /// Maximum number of values, if bounded.
    pub max: Option<u16>,
}

impl Arity {
    /// Exactly one value.
    pub const ONE: Self = Self { min: 1, max: Some(1) };

    /// Zero or one value.
    pub const OPTIONAL_ONE: Self = Self { min: 0, max: Some(1) };

    /// Zero or more values.
    pub const ZERO_OR_MORE: Self = Self { min: 0, max: None };

    /// One or more values.
    pub const ONE_OR_MORE: Self = Self { min: 1, max: None };
}

/// UI/completion hint for a value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ValueHint {
    /// No specific hint.
    Unknown,
    /// Filesystem file path.
    FilePath,
    /// Filesystem directory path.
    DirPath,
    /// Command or executable name.
    CommandName,
    /// Environment variable name.
    EnvVar,
    /// URL-like value.
    Url,
}

/// Declared possible value metadata.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PossibleValue {
    /// Canonical value spelling.
    pub value: String,
    /// Optional help text.
    pub help: Option<String>,
    /// Whether this value is hidden from normal presentation.
    pub hidden: bool,
}

impl PossibleValue {
    /// Create a new possible value.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self { value: value.into(), help: None, hidden: false }
    }

    /// Set help text.
    #[must_use]
    pub fn help(mut self, text: impl Into<String>) -> Self {
        self.help = Some(text.into());
        self
    }

    /// Mark whether this value is hidden.
    #[must_use]
    pub fn hidden(mut self, yes: bool) -> Self {
        self.hidden = yes;
        self
    }
}

/// Default value metadata.
///
/// This is schema metadata, not necessarily a fully decoded runtime value.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum DefaultValue {
    /// Canonical string default.
    String(String),
    /// Display-only default representation.
    Display(String),
}

/// Semantic validator applied to raw values before typed decode.
///
/// Validators are part of the compiled schema and are automatically enforced by
/// the decode layer.
///
/// They complement:
///
/// - [`ParserKind`], which describes the target value shape
/// - [`ValueHint`], which describes UX/completion intent
///
/// # Examples
///
/// ```rust,ignore
/// let spec = ValueSpecBuilder::new(ParserKind::PathBuf)
///     .hint(ValueHint::DirPath)
///     .validate(Validator::Directory);
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Validator {
    /// Require that the path exists.
    Exists,
    /// Require that the path exists and is a regular file.
    File,
    /// Require that the path exists and is a directory.
    Directory,
}

/// Error produced by a custom value validator.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct ValueValidationError {
    message: Box<str>,
}

impl ValueValidationError {
    #[must_use]
    pub fn new(message: impl Into<Box<str>>) -> Self {
        Self { message: message.into() }
    }

    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Erased semantic validator over raw values.
///
/// Custom validators run during decode before typed conversion.
pub trait ErasedValueValidator: std::fmt::Debug + Send + Sync + 'static {
    /// Stable human-readable validator name.
    fn name(&self) -> &'static str;

    /// Validate one raw value.
    ///
    /// # Errors
    ///
    /// Returns a validation error describing why the value was rejected.
    fn validate(&self, value: &crate::parse::RawValue) -> Result<(), ValueValidationError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_builder_collects_declared_items() {
        let cmd = CommandBuilder::new("acme")
            .about("Example")
            .alias("a")
            .arg(ArgBuilder::flag("verbose"))
            .group(GroupBuilder::new("mode"))
            .subcommand(CommandBuilder::new("build"));

        assert_eq!(cmd.name(), "acme");
        assert_eq!(cmd.about_ref(), Some("Example"));
        assert_eq!(cmd.aliases_ref(), ["a"]);
        assert_eq!(cmd.args_ref().len(), 1);
        assert_eq!(cmd.groups_ref().len(), 1);
        assert_eq!(cmd.subcommands_ref().len(), 1);
    }

    #[test]
    fn flag_option_and_positional_have_expected_defaults() {
        let flag = ArgBuilder::flag("verbose");
        assert_eq!(flag.kind(), ArgKind::Flag);
        assert_eq!(flag.action_ref(), ArgAction::SetTrue);
        assert!(flag.value_ref().is_none());

        let option = ArgBuilder::option("config");
        assert_eq!(option.kind(), ArgKind::Option);
        assert_eq!(option.action_ref(), ArgAction::Set);
        assert!(option.value_ref().is_some());

        let positional = ArgBuilder::positional("input");
        assert_eq!(positional.kind(), ArgKind::Positional);
        assert_eq!(positional.action_ref(), ArgAction::Set);
        assert!(positional.value_ref().is_some());
    }

    #[test]
    fn arg_builder_relations_are_recorded() {
        let arg = ArgBuilder::flag("verbose")
            .requires("config")
            .conflicts_with("quiet")
            .in_group("verbosity");

        assert_eq!(arg.requires_ref(), ["config"]);
        assert_eq!(arg.conflicts_ref(), ["quiet"]);
        assert_eq!(arg.groups_ref(), ["verbosity"]);
    }

    #[test]
    fn group_builder_collects_members() {
        let group = GroupBuilder::new("output")
            .member("json")
            .member("yaml")
            .required(true)
            .multiple(false)
            .relation(GroupRelation::OneOf);

        assert_eq!(group.id(), "output");
        assert_eq!(group.members_ref(), ["json", "yaml"]);
        assert!(group.required_flag());
        assert!(!group.multiple_flag());
        assert_eq!(group.relation_kind(), GroupRelation::OneOf);
    }

    #[test]
    fn value_spec_builder_collects_metadata() {
        let spec = ValueSpecBuilder::new(ParserKind::PathBuf)
            .arity(Arity::OPTIONAL_ONE)
            .hint(ValueHint::FilePath)
            .possible_value(PossibleValue::new("Cargo.toml").help("manifest"))
            .default_value(DefaultValue::Display("<auto>".into()));

        assert!(matches!(spec.parser, ParserKind::PathBuf));
        assert_eq!(spec.arity, Arity::OPTIONAL_ONE);
        assert_eq!(spec.hint, ValueHint::FilePath);
        assert_eq!(spec.possible_values.len(), 1);
        assert!(spec.default.is_some());
    }

    #[test]
    fn possible_value_builder_helpers_work() {
        let value = PossibleValue::new("json").help("machine-readable output").hidden(true);

        assert_eq!(value.value, "json");
        assert_eq!(value.help.as_deref(), Some("machine-readable output"));
        assert!(value.hidden);
    }
}
