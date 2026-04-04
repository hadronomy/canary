//! High-level parsed match result.
//!
//! This module provides [`Matches`], the owned runtime result returned by the
//! high-level parse API.
//!
//! [`Matches`] owns the compiled command, raw parse output, and argv snapshot.
//! The primary way to query decoded results is through [`Matches::root`], which
//! returns a [`crate::decode::MatchRef`] over the root matched command.

use crate::decode::{DecodeError, MatchRef};
use crate::parse::ParseOutput;
use crate::runtime_error::ArgvSnapshot;
use crate::schema::{Command, CommandRef};

/// High-level parsed command matches.
///
/// This is the owned runtime object returned by the high-level parse API.
///
/// It owns:
///
/// - the compiled command schema handle
/// - the raw parse output
/// - a snapshot of the original argv for error reporting
///
/// The primary query surface is [`MatchRef`], obtained via [`Self::root`].
#[derive(Clone, Debug)]
pub struct Matches {
    command: Command,
    output: ParseOutput,
    snapshot: ArgvSnapshot,
}

/// Trait for extracting a fully typed structure from a matched command.
///
/// This trait is implemented against [`MatchRef`], which makes it work naturally
/// for both the root command and nested subcommands.
///
/// # Examples
///
/// ```rust,ignore
/// use anko::{DecodeError, FromMatch, MatchRef};
///
/// struct Config {
///     verbose: u64,
///     path: Option<std::path::PathBuf>,
/// }
///
/// impl FromMatch for Config {
///     fn from_match(m: MatchRef<'_>) -> Result<Self, DecodeError> {
///         Ok(Self {
///             verbose: m.get_count("verbose")?,
///             path: m.get_one("path")?,
///         })
///     }
/// }
/// ```
pub trait FromMatch: Sized {
    /// Constructs this type from a matched command view.
    fn from_match(m: MatchRef<'_>) -> Result<Self, DecodeError>;
}

impl Matches {
    /// Creates a new `Matches` object from a compiled command, parse output,
    /// and argv snapshot.
    #[must_use]
    pub fn new(command: Command, output: ParseOutput, snapshot: ArgvSnapshot) -> Self {
        Self { command, output, snapshot }
    }

    /// Returns the compiled command handle.
    #[must_use]
    pub fn command(&self) -> &Command {
        &self.command
    }

    /// Returns the raw parse output.
    #[must_use]
    pub fn output(&self) -> &ParseOutput {
        &self.output
    }

    /// Returns the argv snapshot.
    #[must_use]
    pub fn snapshot(&self) -> &ArgvSnapshot {
        &self.snapshot
    }

    /// Returns the root matched command as a typed decode view.
    ///
    /// This is the primary entry point for decoded queries over the parse result.
    #[must_use]
    pub fn root(&self) -> MatchRef<'_> {
        self.output.root_ref(&self.command).with_snapshot(&self.snapshot)
    }

    /// Prints a decode error with full diagnostic context and exits.
    pub fn exit_with_error(&self, err: DecodeError) -> ! {
        self.root().exit_with_error(err)
    }

    /// Returns the matched root command name.
    #[must_use]
    pub fn command_name(&self) -> &str {
        self.command.name()
    }

    /// Returns `true` if any matched command requested synthesized help.
    #[must_use]
    pub fn help_requested(&self) -> bool {
        self.help_command().is_some()
    }

    /// Returns the command whose help was requested, if any.
    #[must_use]
    pub fn help_command(&self) -> Option<CommandRef<'_>> {
        self.root().requested_help_command()
    }

    /// Extracts a strongly typed value from the root matched command.
    ///
    /// New code should generally prefer `matches.root().extract()`, but this
    /// method is retained for convenience and compatibility.
    pub fn extract<T: FromMatch>(&self) -> Result<T, DecodeError> {
        self.root().extract()
    }

    /// Extracts a strongly typed value from the root matched command, or exits
    /// with a diagnostic if decoding fails.
    ///
    /// New code should generally prefer `matches.root().extract_or_exit()`, but
    /// this method is retained for convenience and compatibility.
    pub fn extract_or_exit<T: FromMatch>(&self) -> T {
        self.root().extract_or_exit()
    }
}
