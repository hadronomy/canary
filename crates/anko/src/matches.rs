//! High-level parsed match result.
//!
//! This module provides [`Matches`], the main user-facing runtime result for
//! parsing a compiled [`crate::Command`].

use crate::decode::{ArgMatchRef, DecodeError, FromRawValue, MatchRef};
use crate::parse::ParseOutput;
use crate::runtime_error::ArgvSnapshot;
use crate::schema::{Command, CommandRef};

/// High-level parsed command matches.
///
/// This is the main runtime object returned by the high-level parse API.
///
/// It owns:
///
/// - the compiled command schema handle
/// - the raw parse output
/// - a snapshot of the original argv for error reporting
///
/// and provides:
///
/// - root decode access
/// - convenience methods for common root-level lookups
#[derive(Clone, Debug)]
pub struct Matches {
    command: Command,
    output: ParseOutput,
    snapshot: ArgvSnapshot,
}

/// A delightful trait for extracting a fully typed structure directly from parsed matches.
///
/// This moves away from "stringly-typed" extractions sprinkled throughout your codebase
/// and centralizes mapping the CLI arguments into your application's configuration struct.
///
/// # Examples
///
/// ```rust,ignore
/// struct Config {
///     verbose: u64,
///     path: Option<PathBuf>,
/// }
///
/// impl FromMatches for Config {
///     fn from_matches(matches: &Matches) -> Result<Self, DecodeError> {
///         Ok(Self {
///             verbose: matches.get_count("verbose")?,
///             path: matches.get_one("path")?,
///         })
///     }
/// }
///
/// let config: Config = matches.extract_or_exit();
/// ```
pub trait FromMatches: Sized {
    /// Construct this type from a successful parse result.
    fn from_matches(matches: &Matches) -> Result<Self, DecodeError>;
}

impl Matches {
    /// Create a new `Matches` object from a compiled command, parse output, and argv snapshot.
    #[must_use]
    pub fn new(command: Command, output: ParseOutput, snapshot: ArgvSnapshot) -> Self {
        Self { command, output, snapshot }
    }

    /// Return the compiled command handle.
    #[must_use]
    pub fn command(&self) -> &Command {
        &self.command
    }

    /// Return the raw parse output.
    #[must_use]
    pub fn output(&self) -> &ParseOutput {
        &self.output
    }

    /// Return the argv snapshot.
    #[must_use]
    pub fn snapshot(&self) -> &ArgvSnapshot {
        &self.snapshot
    }

    /// Return the root matched command as a typed decode view.
    #[must_use]
    pub fn root(&self) -> MatchRef<'_> {
        self.output.root_ref(&self.command).with_snapshot(&self.snapshot)
    }

    /// Print a decode error with full diagnostic context and exit.
    pub fn exit_with_error(&self, err: DecodeError) -> ! {
        self.root().exit_with_error(err)
    }

    /// Return the matched root command name.
    #[must_use]
    pub fn command_name(&self) -> &str {
        self.command.name()
    }

    /// Return `true` if any matched command requested synthesized help.
    #[must_use]
    pub fn help_requested(&self) -> bool {
        self.root().requested_help_command().is_some()
    }

    /// Return the command whose help was requested, if any.
    #[must_use]
    pub fn help_command(&self) -> Option<CommandRef<'_>> {
        self.root().requested_help_command()
    }

    /// Return `true` if the root arg with canonical id `id` is present.
    pub fn contains(&self, id: &str) -> Result<bool, DecodeError> {
        self.root().contains(id)
    }

    /// Return a boolean-style presence value for `id`.
    pub fn get_flag(&self, id: &str) -> Result<bool, DecodeError> {
        self.root().get_flag(id)
    }

    /// Return a boolean-style presence value for `id`, or exit with error.
    pub fn get_flag_or_exit(&self, id: &str) -> bool {
        self.root().get_flag_or_exit(id)
    }

    /// Return the occurrence count for `id`.
    pub fn get_count(&self, id: &str) -> Result<u64, DecodeError> {
        self.root().get_count(id)
    }

    /// Return the occurrence count for `id`, or exit with error.
    pub fn get_count_or_exit(&self, id: &str) -> u64 {
        self.root().get_count_or_exit(id)
    }

    /// Decode zero or one typed value for `id`.
    pub fn get_one<T>(&self, id: &str) -> Result<Option<T>, DecodeError>
    where
        T: FromRawValue,
    {
        self.root().get_one(id)
    }

    /// Decode zero or one typed value for `id`, or exit with error.
    pub fn get_one_or_exit<T>(&self, id: &str) -> Option<T>
    where
        T: FromRawValue,
    {
        self.root().get_one_or_exit(id)
    }

    /// Decode all values for `id`.
    pub fn get_many<T>(&self, id: &str) -> Result<Vec<T>, DecodeError>
    where
        T: FromRawValue,
    {
        self.root().get_many(id)
    }

    /// Decode all values for `id`, or exit with error.
    pub fn get_many_or_exit<T>(&self, id: &str) -> Vec<T>
    where
        T: FromRawValue,
    {
        self.root().get_many_or_exit(id)
    }

    /// Return one raw value for `id`, if present.
    pub fn get_one_raw(&self, id: &str) -> Result<Option<crate::parse::RawValue>, DecodeError> {
        self.root().get_one_raw(id)
    }

    /// Return all raw values for `id`.
    pub fn get_many_raw(&self, id: &str) -> Result<Vec<crate::parse::RawValue>, DecodeError> {
        self.root().get_many_raw(id)
    }

    /// Return the root arg match for `id`, if present.
    pub fn arg(&self, id: &str) -> Result<Option<ArgMatchRef<'_>>, DecodeError> {
        self.root().arg(id)
    }

    /// Return the nested matched subcommand, if any.
    #[must_use]
    pub fn subcommand(&self) -> Option<MatchRef<'_>> {
        self.root().subcommand()
    }

    /// Delightly extract a strongly-typed struct implementing [`FromMatches`].
    pub fn extract<T: FromMatches>(&self) -> Result<T, DecodeError> {
        T::from_matches(self)
    }

    /// Extract a strongly-typed struct implementing [`FromMatches`],
    /// or exit gracefully with a beautiful diagnostic if decoding fails.
    pub fn extract_or_exit<T: FromMatches>(&self) -> T {
        self.extract().unwrap_or_else(|err| self.exit_with_error(err))
    }
}
