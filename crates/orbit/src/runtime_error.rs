//!
//! This is the main error type returned by the high-level runtime API such as:
//!
//! - [`crate::schema::Command::parse_from`]
//! - [`crate::schema::Command::parse_env`]
//!
//! It unifies the lower-level pipeline errors into one public runtime-facing
//! error type.

use std::ffi::OsString;

use thiserror::Error;

use crate::decode::DecodeError;
use crate::ids::CommandId;
use crate::parse::{NormalizeError, ParseError, RawValue};
use crate::runtime_diagnostic::{RuntimeDiagnostic, RuntimeEmitError};

/// Snapshot of the original argv used for runtime diagnostics.
///
/// This stores:
///
/// - the program name, if any
/// - the real CLI args, excluding the program name
///
/// It is intended purely for diagnostics and presentation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArgvSnapshot {
    program: Option<RawValue>,
    args: Box<[RawValue]>,
}

impl ArgvSnapshot {
    /// Build a snapshot from an argv-like iterator.
    #[must_use]
    pub fn from_argv<I, T>(iter: I) -> Self
    where
        I: IntoIterator<Item = T>,
        T: Into<OsString>,
    {
        let mut iter = iter.into_iter();
        let program = iter.next().map(|value| RawValue::from(value.into()));
        let args =
            iter.map(|value| RawValue::from(value.into())).collect::<Vec<_>>().into_boxed_slice();

        Self { program, args }
    }

    /// Return the program name, if any.
    #[must_use]
    pub fn program(&self) -> Option<&RawValue> {
        self.program.as_ref()
    }

    /// Return the real CLI args.
    #[must_use]
    pub fn args(&self) -> &[RawValue] {
        &self.args
    }

    /// Return the arg at `index`, if present.
    #[must_use]
    pub fn get(&self, index: u32) -> Option<&RawValue> {
        self.args.get(index as usize)
    }

    /// Return the number of real CLI args.
    #[must_use]
    pub fn len(&self) -> usize {
        self.args.len()
    }

    /// Return `true` if there are no real CLI args.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.args.is_empty()
    }
}

/// Top-level runtime error for command execution input handling.
#[derive(Debug, Clone, Error)]
#[non_exhaustive]
pub enum RuntimeError {
    /// Token normalization failed.
    #[error(transparent)]
    Normalize(#[from] NormalizeError),

    /// Command parsing failed.
    #[error("command parsing failed")]
    Parse(Vec<ParseError>),

    /// Typed decode failed.
    #[error(transparent)]
    Decode(#[from] DecodeError),

    /// Help was requested for the given command.
    #[error("help requested")]
    HelpRequested {
        /// Command for which help should be shown.
        command: CommandId,
    },
}

/// Delightfully integrate multi-error accumulation into the standard `?` operator pipeline.
impl From<Vec<ParseError>> for RuntimeError {
    fn from(errors: Vec<ParseError>) -> Self {
        Self::Parse(errors)
    }
}

impl RuntimeError {
    /// Convert this error into a rich runtime diagnostic.
    #[must_use]
    pub fn into_diagnostic(self) -> RuntimeDiagnostic {
        RuntimeDiagnostic::new(self, None)
    }

    /// Convert this error into a rich runtime diagnostic with argv context.
    #[must_use]
    pub fn into_diagnostic_with_argv(self, argv: ArgvSnapshot) -> RuntimeDiagnostic {
        RuntimeDiagnostic::new(self, Some(argv))
    }

    /// Print this error to stderr using Ariadne by default.
    ///
    /// If no argv context is attached, this will still render richly where
    /// possible, using synthetic argv placeholders.
    pub fn eprint(&self) -> Result<(), RuntimeEmitError> {
        RuntimeDiagnostic::new(self.clone(), None).eprint()
    }

    /// Print this error to stderr using Ariadne with exact argv rendering.
    pub fn eprint_with_argv(&self, argv: ArgvSnapshot) -> Result<(), RuntimeEmitError> {
        RuntimeDiagnostic::new(self.clone(), Some(argv)).eprint()
    }

    /// Print this error to stdout using Ariadne by default.
    ///
    /// If no argv context is attached, this will still render richly where
    /// possible, using synthetic argv placeholders.
    pub fn print(&self) -> Result<(), RuntimeEmitError> {
        RuntimeDiagnostic::new(self.clone(), None).print()
    }

    /// Print this error to stdout using Ariadne with exact argv rendering.
    pub fn print_with_argv(&self, argv: ArgvSnapshot) -> Result<(), RuntimeEmitError> {
        RuntimeDiagnostic::new(self.clone(), Some(argv)).print()
    }

    /// Return the requested help command id, if this is a help request.
    #[must_use]
    pub fn help_requested_command(&self) -> Option<CommandId> {
        match self {
            Self::HelpRequested { command } => Some(*command),
            _ => None,
        }
    }

    /// Return `true` if this error is actually a help request signal.
    #[must_use]
    pub fn is_help_requested(&self) -> bool {
        matches!(self, Self::HelpRequested { .. })
    }
}
