//! Authoring-time builder API for command schemas.
//!
//! This module defines the mutable, ergonomic front-end used to construct a CLI
//! schema before compilation into the immutable runtime[`crate::Command`].
//!
//! The builders here are intended for:
//! - Dynamic or runtime-defined CLIs
//! - Derive-generated schema construction
//! - Tests and schema fixtures
//! - Advanced programmatic schema authoring
//!
//! The model is:
//! - Mutable while authoring
//! - Validated and lowered by compilation
//! - Immutable once built
//!
//! # Typical usage
//!
//! ```rust,ignore
//! use orbit::builder::{ArgAction, ArgBuilder, CommandBuilder};
//! use std::path::PathBuf;
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
//!         ArgBuilder::option::<PathBuf>("config")
//!             .long("config")
//!             .validate_file()
//!             .optional()
//!             .help("Path to config file"),
//!     )
//!     .build()?;
//! # Ok::<(), orbit::BuildError>(())
//! ```

use std::fmt;
use std::ops::{Range, RangeFrom, RangeFull, RangeInclusive};
use std::sync::Arc;

use crate::compiler::compile_command;
use crate::parse::RawValue;
use crate::{BuildError, Command};

/// A trait that automatically configures a [`ValueSpecBuilder`] based on a target Rust type.
///
/// This provides a delightful, type-driven developer experience. Instead of manually
/// specifying parser kinds and arities, the builder infers them from the generic type parameter
/// and seamlessly injects high-speed parse-time validation.
///
/// # Examples
///
/// ```rust,ignore
/// // Automatically infers `ParserKind::PathBuf` and `ValueHint::FilePath`
/// ArgBuilder::option::<std::path::PathBuf>("config");
///
/// // Automatically sets up robust parse-time u32 validation
/// ArgBuilder::option::<u32>("retries");
/// ```
pub trait ValueTarget {
    /// Configures the provided specification builder for this target type.
    fn configure(spec: &mut ValueSpecBuilder);
}

impl ValueTarget for String {
    fn configure(spec: &mut ValueSpecBuilder) {
        spec.parser = ParserKind::String;
        spec.custom_validators.push(Arc::new(ClosureValidator(|val: &RawValue| {
            val.try_as_str().map_err(|_| "value must be valid UTF-8".to_string())?;
            Ok(())
        })));
    }
}

impl ValueTarget for std::path::PathBuf {
    fn configure(spec: &mut ValueSpecBuilder) {
        spec.parser = ParserKind::PathBuf;
        spec.hint = ValueHint::FilePath;
    }
}

macro_rules! impl_value_target_primitives {
    ($($t:ty),* $(,)?) => {
        $(
            impl ValueTarget for $t {
                fn configure(spec: &mut ValueSpecBuilder) {
                    spec.parser = ParserKind::String;
                    spec.custom_validators.push(Arc::new(ClosureValidator(|val: &RawValue| {
                        let text = val.try_as_str().map_err(|_| "value must be valid UTF-8".to_string())?;
                        text.parse::<$t>().map_err(|e| format!("invalid {}: {}", stringify!($t), e))?;
                        Ok(())
                    })));
                }
            }
        )*
    };
}

impl_value_target_primitives!(
    bool, u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize, f32, f64
);

impl<T: ValueTarget> ValueTarget for Option<T> {
    fn configure(spec: &mut ValueSpecBuilder) {
        T::configure(spec);
        spec.arity = Arity::OPTIONAL_ONE;
    }
}

/// An inline, closure-based semantic validator for parsed arguments.
///
/// This allows developers to write quick, inline validation logic without needing
/// to implement the full[`ErasedValueValidator`] trait manually.
pub struct ClosureValidator<F>(pub F);

impl<F> fmt::Debug for ClosureValidator<F> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClosureValidator(..)")
    }
}

impl<F> ErasedValueValidator for ClosureValidator<F>
where
    F: Fn(&RawValue) -> Result<(), String> + Send + Sync + 'static,
{
    fn name(&self) -> &'static str {
        "inline-closure"
    }

    fn validate(&self, value: &RawValue) -> Result<(), ValueValidationError> {
        (self.0)(value).map_err(|msg| ValueValidationError::new(msg.into_boxed_str()))
    }
}

/// Builder for a command schema.
///
/// This is the primary authoring entry point. It accumulates subcommands, arguments,
/// and metadata before compiling them into a high-performance runtime representation.
#[derive(Clone, Debug, Default)]
pub struct CommandBuilder {
    pub(crate) name: String,
    pub(crate) about: Option<String>,
    pub(crate) long_about: Option<String>,
    pub(crate) aliases: Vec<String>,
    pub(crate) subcommands: Vec<CommandBuilder>,
    pub(crate) args: Vec<ArgDecl>,
    pub(crate) groups: Vec<GroupBuilder>,
}

impl CommandBuilder {
    /// Create a new command builder with the given name.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Self::default() }
    }

    /// Compile this builder into an immutable runtime [`crate::Command`].
    ///
    /// # Errors
    ///
    /// Returns[`crate::BuildError`] if the schema is invalid (e.g., duplicate names,
    /// invalid relations, or positional layout collisions).
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

    /// Add a directly declared argument.
    #[must_use]
    pub fn arg(mut self, arg: impl IntoArgDecl) -> Self {
        self.args.push(arg.into_arg_decl());
        self
    }

    /// Add multiple directly declared arguments.
    #[must_use]
    pub fn args<I>(mut self, args: I) -> Self
    where
        I: IntoIterator,
        I::Item: IntoArgDecl,
    {
        self.args.extend(args.into_iter().map(IntoArgDecl::into_arg_decl));
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
    pub fn args_ref(&self) -> &[ArgDecl] {
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

/// Trait to safely erase strongly-typed arguments into canonical schema declarations.
pub trait IntoArgDecl {
    /// Convert the instance into an erased argument declaration.
    fn into_arg_decl(self) -> ArgDecl;
}

impl<T, K> IntoArgDecl for ArgBuilder<T, K> {
    fn into_arg_decl(self) -> ArgDecl {
        self.decl
    }
}

impl IntoArgDecl for ArgDecl {
    fn into_arg_decl(self) -> ArgDecl {
        self
    }
}

// -----------------------------------------------------------------------------
// TYPESTATES FOR ARG BUILDERS
// -----------------------------------------------------------------------------

/// Marker trait for argument routing kinds.
pub trait ArgRoutingKind {}

/// Marker trait for arguments that can have short and long names.
pub trait IsNamed: ArgRoutingKind {}

/// Marker trait for arguments that take a value.
pub trait TakesValue: ArgRoutingKind {}

/// Typestate marker for a flag argument.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Flag;
impl ArgRoutingKind for Flag {}
impl IsNamed for Flag {}

/// Typestate marker for a named option argument.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct NamedOption;
impl ArgRoutingKind for NamedOption {}
impl IsNamed for NamedOption {}
impl TakesValue for NamedOption {}

/// Typestate marker for a positional argument.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Positional;
impl ArgRoutingKind for Positional {}
impl TakesValue for Positional {}

/// Canonical, type-erased argument declaration.
///
/// This is the internal representation used by the schema compiler to maintain
/// heterogeneous collections of arguments.
#[derive(Clone, Debug)]
pub struct ArgDecl {
    pub(crate) id: String,
    pub(crate) kind: ArgKind,
    pub(crate) declared_global: bool,
    pub(crate) short: Option<char>,
    pub(crate) long: Option<String>,
    pub(crate) aliases: Vec<ArgAlias>,
    pub(crate) action: ArgActionKind,
    pub(crate) value: Option<ValueSpecBuilder>,
    pub(crate) env: Option<String>,
    pub(crate) help: HelpMeta,
    pub(crate) visibility: Visibility,
    pub(crate) position: Option<u16>,
    pub(crate) requires: Vec<String>,
    pub(crate) conflicts: Vec<String>,
    pub(crate) groups: Vec<String>,
    pub(crate) required: bool,
}

impl ArgDecl {
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

    /// Return `true` if this arg is required.
    #[must_use]
    pub fn required_flag(&self) -> bool {
        self.required
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
    pub fn action_ref(&self) -> ArgActionKind {
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

/// Strongly-typed builder for a command argument.
///
/// The `T` parameter enforces semantic correctness of the parsed data type, while the
/// `Kind` parameter leverages the Typestate pattern to make invalid state configurations
/// (like adding `position(0)` to a flag) strictly unrepresentable at compile time.
#[derive(Clone, Debug)]
pub struct ArgBuilder<T = String, Kind = NamedOption> {
    pub(crate) decl: ArgDecl,
    _marker: std::marker::PhantomData<(T, Kind)>,
}

impl ArgBuilder {
    /// Create a new flag arg. Flags default to [`ArgActionKind::SetTrue`].
    #[must_use]
    pub fn flag(id: impl Into<String>) -> ArgBuilder<bool, Flag> {
        ArgBuilder {
            decl: ArgDecl {
                id: id.into(),
                kind: ArgKind::Flag,
                declared_global: false,
                short: None,
                long: None,
                aliases: Vec::new(),
                action: ArgActionKind::SetTrue,
                value: None,
                env: None,
                help: HelpMeta::default(),
                visibility: Visibility::Normal,
                position: None,
                requires: Vec::new(),
                conflicts: Vec::new(),
                groups: Vec::new(),
                required: false,
            },
            _marker: std::marker::PhantomData,
        }
    }

    /// Create a new named option arg that parses into `T`.
    ///
    /// The argument's metadata (parser kind, arity, hints, validations) is inferred
    /// automatically from `T` via the [`ValueTarget`] trait.
    #[must_use]
    pub fn option<T: ValueTarget>(id: impl Into<String>) -> ArgBuilder<T, NamedOption> {
        let mut spec = ValueSpecBuilder::default();
        T::configure(&mut spec);
        ArgBuilder {
            decl: ArgDecl {
                id: id.into(),
                kind: ArgKind::Option,
                declared_global: false,
                short: None,
                long: None,
                aliases: Vec::new(),
                action: ArgActionKind::Set,
                value: Some(spec),
                env: None,
                help: HelpMeta::default(),
                visibility: Visibility::Normal,
                position: None,
                requires: Vec::new(),
                conflicts: Vec::new(),
                groups: Vec::new(),
                required: false,
            },
            _marker: std::marker::PhantomData,
        }
    }

    /// Create a new positional arg that parses into `T`.
    #[must_use]
    pub fn positional<T: ValueTarget>(id: impl Into<String>) -> ArgBuilder<T, Positional> {
        let mut spec = ValueSpecBuilder::default();
        T::configure(&mut spec);
        ArgBuilder {
            decl: ArgDecl {
                id: id.into(),
                kind: ArgKind::Positional,
                declared_global: false,
                short: None,
                long: None,
                aliases: Vec::new(),
                action: ArgActionKind::Set,
                value: Some(spec),
                env: None,
                help: HelpMeta::default(),
                visibility: Visibility::Normal,
                position: None,
                requires: Vec::new(),
                conflicts: Vec::new(),
                groups: Vec::new(),
                required: false,
            },
            _marker: std::marker::PhantomData,
        }
    }
}

// Common methods available across all Argument Kinds
impl<T, K> ArgBuilder<T, K> {
    /// Mark whether this arg is declared global.
    #[must_use]
    pub fn global(mut self, yes: bool) -> Self {
        self.decl.declared_global = yes;
        self
    }

    /// Set the environment variable name used as a value source.
    #[must_use]
    pub fn env(mut self, env: impl Into<String>) -> Self {
        self.decl.env = Some(env.into());
        self
    }

    /// Set short help text.
    #[must_use]
    pub fn help(mut self, text: impl Into<String>) -> Self {
        self.decl.help.help = Some(text.into());
        self
    }

    /// Set long help text.
    #[must_use]
    pub fn long_help(mut self, text: impl Into<String>) -> Self {
        self.decl.help.long_help = Some(text.into());
        self
    }

    /// Set a help heading.
    #[must_use]
    pub fn heading(mut self, heading: impl Into<String>) -> Self {
        self.decl.help.heading = Some(heading.into());
        self
    }

    /// Set the displayed value name.
    #[must_use]
    pub fn value_name(mut self, name: impl Into<String>) -> Self {
        self.decl.help.value_name = Some(name.into());
        self
    }

    /// Set visibility metadata.
    #[must_use]
    pub fn visibility(mut self, visibility: Visibility) -> Self {
        self.decl.visibility = visibility;
        self
    }

    /// Declare that this arg requires another arg or group by symbolic ID.
    #[must_use]
    pub fn requires(mut self, id: impl Into<String>) -> Self {
        self.decl.requires.push(id.into());
        self
    }

    /// Declare that this arg conflicts with another arg or group by symbolic ID.
    #[must_use]
    pub fn conflicts_with(mut self, id: impl Into<String>) -> Self {
        self.decl.conflicts.push(id.into());
        self
    }

    /// Declare membership in a group by symbolic group ID.
    #[must_use]
    pub fn in_group(mut self, id: impl Into<String>) -> Self {
        self.decl.groups.push(id.into());
        self
    }

    /// Set the semantic action and powerfully transform the Builder's generic type.
    ///
    /// # Examples
    /// ```rust,ignore
    /// // Transforms `bool` -> `u64`
    /// ArgBuilder::flag("verbose").action(ArgAction::Count);
    ///
    /// // Transforms `String` -> `Vec<String>`
    /// ArgBuilder::option::<String>("feature").action(ArgAction::Append);
    /// ```
    #[must_use]
    pub fn action<A: ActionCombinator>(mut self, _action: A) -> ArgBuilder<A::Output<T>, K> {
        self.decl.action = A::kind();
        A::apply(&mut self.decl.value);
        ArgBuilder { decl: self.decl, _marker: std::marker::PhantomData }
    }

    /// Mark whether this argument must be provided.
    #[must_use]
    pub fn required(mut self, yes: bool) -> Self {
        self.decl.required = yes;
        self
    }

    #[must_use]
    pub fn required_flag(&self) -> bool {
        self.decl.required
    }

    // --- Accessors for Introspection & Tests ---

    #[must_use]
    pub fn id(&self) -> &str {
        self.decl.id()
    }
    #[must_use]
    pub fn kind(&self) -> ArgKind {
        self.decl.kind()
    }
    #[must_use]
    pub fn declared_global(&self) -> bool {
        self.decl.declared_global()
    }
    #[must_use]
    pub fn short_ref(&self) -> Option<char> {
        self.decl.short_ref()
    }
    #[must_use]
    pub fn long_ref(&self) -> Option<&str> {
        self.decl.long_ref()
    }
    #[must_use]
    pub fn aliases_ref(&self) -> &[ArgAlias] {
        self.decl.aliases_ref()
    }
    #[must_use]
    pub fn action_ref(&self) -> ArgActionKind {
        self.decl.action_ref()
    }
    #[must_use]
    pub fn value_ref(&self) -> Option<&ValueSpecBuilder> {
        self.decl.value_ref()
    }
    #[must_use]
    pub fn env_ref(&self) -> Option<&str> {
        self.decl.env_ref()
    }
    #[must_use]
    pub fn help_ref(&self) -> &HelpMeta {
        self.decl.help_ref()
    }
    #[must_use]
    pub fn visibility_ref(&self) -> &Visibility {
        self.decl.visibility_ref()
    }
    #[must_use]
    pub fn position_ref(&self) -> Option<u16> {
        self.decl.position_ref()
    }
    #[must_use]
    pub fn requires_ref(&self) -> &[String] {
        self.decl.requires_ref()
    }
    #[must_use]
    pub fn conflicts_ref(&self) -> &[String] {
        self.decl.conflicts_ref()
    }
    #[must_use]
    pub fn groups_ref(&self) -> &[String] {
        self.decl.groups_ref()
    }
}

// Methods explicitly restricted to Named Arguments (Flags and Options)
impl<T, K: IsNamed> ArgBuilder<T, K> {
    /// Set the short option character.
    #[must_use]
    pub fn short(mut self, short: char) -> Self {
        self.decl.short = Some(short);
        self
    }

    /// Set the long option name without leading `--`.
    #[must_use]
    pub fn long(mut self, long: impl Into<String>) -> Self {
        self.decl.long = Some(long.into());
        self
    }

    /// Add a visible long alias.
    #[must_use]
    pub fn alias(mut self, name: impl Into<String>) -> Self {
        self.decl.aliases.push(ArgAlias { name: name.into(), hidden: false });
        self
    }

    /// Add a hidden long alias.
    #[must_use]
    pub fn hidden_alias(mut self, name: impl Into<String>) -> Self {
        self.decl.aliases.push(ArgAlias { name: name.into(), hidden: true });
        self
    }
}

// Methods explicitly restricted to Positional Arguments
impl<T> ArgBuilder<T, Positional> {
    /// Set the explicit positional index.
    #[must_use]
    pub fn position(mut self, position: u16) -> Self {
        self.decl.position = Some(position);
        self
    }
}

// Methods explicitly restricted to Arguments that receive a value
impl<T, K: TakesValue> ArgBuilder<T, K> {
    /// Transform this argument to be semantically optional.
    ///
    /// This seamlessly changes the builder's generic type from `T` to `Option<T>`
    /// and adjusts the arity to `OPTIONAL_ONE`.
    #[must_use]
    pub fn optional(mut self) -> ArgBuilder<Option<T>, K> {
        if let Some(spec) = &mut self.decl.value {
            spec.arity = Arity::OPTIONAL_ONE;
        }
        ArgBuilder { decl: self.decl, _marker: std::marker::PhantomData }
    }

    /// Add a built-in semantic validator to this argument's value.
    #[must_use]
    pub fn validate(mut self, validator: Validator) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.validators.push(validator);
        }
        self
    }

    /// Set the UI/completion hint.
    #[must_use]
    pub fn hint(mut self, hint: ValueHint) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.hint = hint;
        }
        self
    }

    /// Set the default string value.
    #[must_use]
    pub fn default_value(mut self, default: impl Into<String>) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.default = Some(DefaultValue::String(default.into()));
        }
        self
    }

    /// Add a possible value.
    #[must_use]
    pub fn possible_value(mut self, value: impl Into<PossibleValue>) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.possible_values.push(value.into());
        }
        self
    }

    /// Add multiple possible values.
    #[must_use]
    pub fn possible_values<I, V>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = V>,
        V: Into<PossibleValue>,
    {
        if let Some(spec) = &mut self.decl.value {
            spec.possible_values.extend(values.into_iter().map(Into::into));
        }
        self
    }

    /// Set the accepted arity using a standard Rust range.
    ///
    /// # Examples
    /// ```rust,ignore
    /// .arity(3)      // Exactly 3
    /// .arity(1..=5)  // Between 1 and 5
    /// .arity(2..)    // At least 2
    /// ```
    #[must_use]
    pub fn arity(mut self, arity: impl Into<Arity>) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.arity = arity.into();
        }
        self
    }

    /// Attach an inline, custom closure validator to the argument.
    #[must_use]
    pub fn validate_with<F>(mut self, f: F) -> Self
    where
        F: Fn(&crate::parse::RawValue) -> Result<(), String> + Send + Sync + 'static,
    {
        if let Some(spec) = &mut self.decl.value {
            spec.custom_validators.push(Arc::new(ClosureValidator(f)));
        }
        self
    }
}

// Methods explicitly restricted to Arguments of type PathBuf
impl<K: TakesValue> ArgBuilder<std::path::PathBuf, K> {
    /// Require that the parsed path exists and is a directory.
    #[must_use]
    pub fn validate_directory(mut self) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.validators.push(Validator::Directory);
            spec.hint = ValueHint::DirPath;
        }
        self
    }

    /// Require that the parsed path exists and is a regular file.
    #[must_use]
    pub fn validate_file(mut self) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.validators.push(Validator::File);
            spec.hint = ValueHint::FilePath;
        }
        self
    }

    /// Require that the parsed path exists.
    #[must_use]
    pub fn validate_exists(mut self) -> Self {
        if let Some(spec) = &mut self.decl.value {
            spec.validators.push(Validator::Exists);
        }
        self
    }
}

/// Builder for an argument group.
///
/// Groups allow schema authors to express higher-level relationships among a
/// set of arguments (e.g., mutually exclusive flags).
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

    /// Add a member argument ID to this group.
    #[must_use]
    pub fn member(mut self, id: impl Into<String>) -> Self {
        self.members.push(id.into());
        self
    }

    /// Add multiple member argument IDs.
    #[must_use]
    pub fn members<I, S>(mut self, members: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.members.extend(members.into_iter().map(Into::into));
        self
    }

    /// Mark whether the group must be satisfied.
    #[must_use]
    pub fn required(mut self, yes: bool) -> Self {
        self.required = yes;
        self
    }

    /// Mark whether multiple members of this group may appear.
    #[must_use]
    pub fn multiple(mut self, yes: bool) -> Self {
        self.multiple = yes;
        self
    }

    /// Set the group's relationship mechanics (e.g., `OneOf`).
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

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }
    #[must_use]
    pub fn members_ref(&self) -> &[String] {
        &self.members
    }
    #[must_use]
    pub fn required_flag(&self) -> bool {
        self.required
    }
    #[must_use]
    pub fn multiple_flag(&self) -> bool {
        self.multiple
    }
    #[must_use]
    pub fn relation_kind(&self) -> GroupRelation {
        self.relation
    }
    #[must_use]
    pub fn help_ref(&self) -> Option<&str> {
        self.help.as_deref()
    }
}

impl<S: Into<String>> Extend<S> for GroupBuilder {
    fn extend<T: IntoIterator<Item = S>>(&mut self, iter: T) {
        self.members.extend(iter.into_iter().map(Into::into));
    }
}

/// Builder for detailed value specification metadata.
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

    #[must_use]
    pub fn arity(mut self, arity: Arity) -> Self {
        self.arity = arity;
        self
    }

    #[must_use]
    pub fn hint(mut self, hint: ValueHint) -> Self {
        self.hint = hint;
        self
    }

    #[must_use]
    pub fn possible_value(mut self, value: PossibleValue) -> Self {
        self.possible_values.push(value);
        self
    }

    #[must_use]
    pub fn possible_values<I>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = PossibleValue>,
    {
        self.possible_values.extend(values);
        self
    }

    #[must_use]
    pub fn default_value(mut self, default: DefaultValue) -> Self {
        self.default = Some(default);
        self
    }

    #[must_use]
    pub fn validate(mut self, validator: Validator) -> Self {
        self.validators.push(validator);
        self
    }

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
    pub name: String,
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

/// Internal semantic action representation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ArgActionKind {
    SetTrue,
    SetFalse,
    Count,
    Set,
    Append,
    Help,
    Version,
}

/// Typestate components for semantic parsing transformations.
///
/// These Zero-Sized Types (ZSTs) are used as arguments to the `action()` builder
/// method, enabling the compiler to infer safe state transitions on the generic
/// `ArgBuilder<T>` parameter.
#[allow(non_snake_case)]
pub mod ArgAction {
    #[derive(Clone, Copy, Debug)]
    pub struct SetTrue;
    #[derive(Clone, Copy, Debug)]
    pub struct SetFalse;
    #[derive(Clone, Copy, Debug)]
    pub struct Count;
    #[derive(Clone, Copy, Debug)]
    pub struct Set;

    /// Collects values into a standard `Vec<T>`.
    #[derive(Clone, Copy, Debug)]
    pub struct Append;

    /// Collects values into a specific generic collection `C`.
    #[derive(Clone, Copy, Debug)]
    pub struct AppendAs<C>(std::marker::PhantomData<C>);

    impl<C> AppendAs<C> {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl<C> Default for AppendAs<C> {
        fn default() -> Self {
            Self(Default::default())
        }
    }

    pub struct Help;
    #[derive(Clone, Copy, Debug)]
    pub struct Version;
}

/// Trait defining how an action transforms the generic type of the Builder.
pub trait ActionCombinator {
    /// The new type this action shifts the builder into.
    type Output<T>;
    /// The runtime enum value to store in the schema.
    fn kind() -> ArgActionKind;
    /// Metadata overrides (like forcing Arity to `ONE_OR_MORE`).
    fn apply(spec: &mut Option<ValueSpecBuilder>);
}

impl ActionCombinator for ArgAction::Append {
    type Output<T> = Vec<T>;

    fn kind() -> ArgActionKind {
        ArgActionKind::Append
    }

    fn apply(spec: &mut Option<ValueSpecBuilder>) {
        if let Some(s) = spec {
            s.arity = Arity::ONE_OR_MORE;
        }
    }
}

impl<C> ActionCombinator for ArgAction::AppendAs<C> {
    type Output<T> = C;

    fn kind() -> ArgActionKind {
        ArgActionKind::Append
    }

    fn apply(spec: &mut Option<ValueSpecBuilder>) {
        if let Some(s) = spec {
            s.arity = Arity::ONE_OR_MORE;
        }
    }
}

impl ActionCombinator for ArgAction::Count {
    type Output<T> = u64;

    fn kind() -> ArgActionKind {
        ArgActionKind::Count
    }

    fn apply(_: &mut Option<ValueSpecBuilder>) {}
}

impl ActionCombinator for ArgAction::Set {
    type Output<T> = T;

    fn kind() -> ArgActionKind {
        ArgActionKind::Set
    }

    fn apply(_: &mut Option<ValueSpecBuilder>) {}
}

impl ActionCombinator for ArgAction::SetTrue {
    type Output<T> = bool;

    fn kind() -> ArgActionKind {
        ArgActionKind::SetTrue
    }

    fn apply(_: &mut Option<ValueSpecBuilder>) {}
}

impl ActionCombinator for ArgAction::Help {
    type Output<T> = bool;

    fn kind() -> ArgActionKind {
        ArgActionKind::Help
    }

    fn apply(_: &mut Option<ValueSpecBuilder>) {}
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
pub trait ErasedValueParser: Send + Sync + 'static {
    fn type_name(&self) -> &'static str;
}

/// Accepted value arity representing quantity invariants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Arity {
    /// Exactly N occurrences are required.
    Exact(u16),
    /// At least N occurrences are required, with no upper bound.
    AtLeast(u16),
    /// Occurrences must fall within the inclusive range [min, max].
    Range(u16, u16),
}

impl Arity {
    /// Exactly one occurrence.
    pub const ONE: Self = Self::Exact(1);
    /// Zero or one occurrences.
    pub const OPTIONAL_ONE: Self = Self::Range(0, 1);
    /// Any number of occurrences, including zero.
    pub const ZERO_OR_MORE: Self = Self::AtLeast(0);
    /// One or more occurrences.
    pub const ONE_OR_MORE: Self = Self::AtLeast(1);

    /// Get the minimum boundary of the arity.
    pub fn min(&self) -> u16 {
        match self {
            Self::Exact(n) => *n,
            Self::AtLeast(n) => *n,
            Self::Range(min, _) => *min,
        }
    }

    /// Get the maximum boundary of the arity, if one exists.
    pub fn max(&self) -> Option<u16> {
        match self {
            Self::Exact(n) => Some(*n),
            Self::AtLeast(_) => None,
            Self::Range(_, max) => Some(*max),
        }
    }
}

impl From<u16> for Arity {
    fn from(exact: u16) -> Self {
        Self::Exact(exact)
    }
}

// Support inclusive ranges: `.arity(1..=5)`
impl From<RangeInclusive<u16>> for Arity {
    fn from(range: RangeInclusive<u16>) -> Self {
        let (min, max) = range.into_inner();
        assert!(min <= max, "Arity range minimum cannot exceed maximum");
        Self::Range(min, max)
    }
}

// Support exclusive ranges: `.arity(1..5)` -> maps to 1..=4
impl From<Range<u16>> for Arity {
    fn from(range: Range<u16>) -> Self {
        assert!(range.start < range.end, "Arity range minimum must be strictly less than maximum");
        Self::Range(range.start, range.end - 1)
    }
}

// Support unbounded ranges: `.arity(2..)`
impl From<RangeFrom<u16>> for Arity {
    fn from(range: RangeFrom<u16>) -> Self {
        Self::AtLeast(range.start)
    }
}

// Support fully unbounded: `.arity(..)`
impl From<RangeFull> for Arity {
    fn from(_: RangeFull) -> Self {
        Self::ZERO_OR_MORE
    }
}

/// UI/completion hint for a value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ValueHint {
    Unknown,
    FilePath,
    DirPath,
    CommandName,
    EnvVar,
    Url,
}

/// Declared possible value metadata.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PossibleValue {
    pub value: String,
    pub help: Option<String>,
    pub hidden: bool,
}

impl PossibleValue {
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

impl From<&str> for PossibleValue {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}

impl From<String> for PossibleValue {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}

/// Default value metadata.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum DefaultValue {
    String(String),
    Display(String),
}

impl From<&str> for DefaultValue {
    fn from(s: &str) -> Self {
        Self::String(s.to_string())
    }
}

impl From<String> for DefaultValue {
    fn from(s: String) -> Self {
        Self::String(s)
    }
}

/// Built-in semantic validator.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Validator {
    Exists,
    File,
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
pub trait ErasedValueValidator: std::fmt::Debug + Send + Sync + 'static {
    fn name(&self) -> &'static str;
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
        assert_eq!(flag.action_ref(), ArgActionKind::SetTrue);
        assert!(flag.value_ref().is_none());

        let option = ArgBuilder::option::<String>("config");
        assert_eq!(option.kind(), ArgKind::Option);
        assert_eq!(option.action_ref(), ArgActionKind::Set);
        assert!(option.value_ref().is_some());

        let positional = ArgBuilder::positional::<String>("input");
        assert_eq!(positional.kind(), ArgKind::Positional);
        assert_eq!(positional.action_ref(), ArgActionKind::Set);
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
