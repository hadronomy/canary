#![allow(unused)]
//! Parse-time errors.
//!
//! These are user-facing errors produced while matching normalized argv against
//! the compiled schema.

use thiserror::Error;

use crate::ids::{ArgId, CommandId};
use crate::parse::model::Span;

/// Error produced while parsing normalized argv.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub struct ParseError {
    kind: ParseErrorKind,
    span: Option<Span>,
    message: Box<str>,
    notes: Box<[Box<str>]>,
    help: Option<Box<str>>,
}

impl ParseError {
    /// Create a new parse error.
    #[must_use]
    pub fn new(kind: ParseErrorKind, span: Option<Span>, message: impl Into<Box<str>>) -> Self {
        Self { kind, span, message: message.into(), notes: Box::new([]), help: None }
    }

    /// Return the error kind.
    #[must_use]
    pub fn kind(&self) -> ParseErrorKind {
        self.kind
    }

    /// Return the source span, if any.
    #[must_use]
    pub fn span(&self) -> Option<Span> {
        self.span
    }

    /// Return the main error message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Return attached notes.
    #[must_use]
    pub fn notes(&self) -> &[Box<str>] {
        &self.notes
    }

    /// Return attached help text, if any.
    #[must_use]
    pub fn help(&self) -> Option<&str> {
        self.help.as_deref()
    }

    /// Attach one note.
    #[must_use]
    pub fn with_note(mut self, note: impl Into<Box<str>>) -> Self {
        let mut notes = self.notes.into_vec();
        notes.push(note.into());
        self.notes = notes.into_boxed_slice();
        self
    }

    /// Attach multiple notes.
    #[must_use]
    pub fn with_notes<I, S>(mut self, notes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<Box<str>>,
    {
        let mut out = self.notes.into_vec();
        out.extend(notes.into_iter().map(Into::into));
        self.notes = out.into_boxed_slice();
        self
    }

    /// Attach help text.
    #[must_use]
    pub fn with_help(mut self, help: impl Into<Box<str>>) -> Self {
        self.help = Some(help.into());
        self
    }
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.span {
            Some(span) => write!(f, "{} at argv[{}]: {}", self.kind, span.arg_index, self.message),
            None => write!(f, "{}: {}", self.kind, self.message),
        }
    }
}

/// Category of parse-time failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ParseErrorKind {
    UnknownLong,
    UnknownShort,
    UnknownSubcommand,
    UnexpectedValue,
    MissingValue,
    MissingRequired,
    MissingGroup,
    Conflict,
    Requires,
    UnexpectedTerminator,
    InvalidLongSyntax,
    NonUtf8OptionLike,
    ValidationFailed,
    ArityMismatch,
}

impl ParseErrorKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnknownLong => "unknown option",
            Self::UnknownShort => "unknown short option",
            Self::UnknownSubcommand => "unknown subcommand",
            Self::UnexpectedValue => "unexpected value",
            Self::MissingValue => "missing value",
            Self::MissingRequired => "missing required argument",
            Self::MissingGroup => "missing required group",
            Self::Conflict => "conflicting arguments",
            Self::Requires => "missing required companion argument",
            Self::UnexpectedTerminator => "unexpected terminator",
            Self::InvalidLongSyntax => "invalid long option syntax",
            Self::NonUtf8OptionLike => "non-utf8 option-like argument",
            Self::ValidationFailed => "validation failed",
            Self::ArityMismatch => "arity mismatch",
        }
    }
}

impl std::fmt::Display for ParseErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Internal richer parse error context used by validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ParseFailure {
    UnknownLong { name: Box<str>, span: Span },
    UnknownShort { name: char, span: Span },
    UnknownSubcommand { command: CommandId, value: Box<str>, span: Span },
    UnexpectedValue { value: Box<str>, span: Span },
    MissingValue { arg: ArgId, span: Span },
    MissingRequired { arg: ArgId, span: Option<Span> },
    MissingGroup { group: crate::ids::GroupId, span: Option<Span> },
    Conflict { left: ArgId, right: ArgId, span: Option<Span> },
    Requires { arg: ArgId, required: ArgId },
    ValidationError { arg: ArgId, span: Span, message: Box<str> },
    ArityMismatch { arg: ArgId, span: Option<Span>, found: usize, min: u16, max: Option<u16> },
}

impl ParseFailure {
    pub(crate) fn into_error(
        self,
        render_arg: impl Fn(ArgId) -> String,
        render_command: impl Fn(CommandId) -> String,
        render_group: impl Fn(crate::ids::GroupId) -> String,
    ) -> ParseError {
        match self {
            Self::UnknownLong { name, span } => ParseError::new(
                ParseErrorKind::UnknownLong,
                Some(span),
                format!("unknown option `--{name}`"),
            ),
            Self::UnknownShort { name, span } => ParseError::new(
                ParseErrorKind::UnknownShort,
                Some(span),
                format!("unknown short option `-{name}`"),
            ),
            Self::UnknownSubcommand { command, value, span } => ParseError::new(
                ParseErrorKind::UnknownSubcommand,
                Some(span),
                format!("unknown subcommand `{value}` for command `{}`", render_command(command)),
            ),
            Self::UnexpectedValue { value, span } => ParseError::new(
                ParseErrorKind::UnexpectedValue,
                Some(span),
                format!("unexpected value `{value}`"),
            ),
            Self::MissingValue { arg, span } => ParseError::new(
                ParseErrorKind::MissingValue,
                Some(span),
                format!("missing value for `{}`", render_arg(arg)),
            ),
            Self::MissingRequired { arg, span } => ParseError::new(
                ParseErrorKind::MissingRequired,
                span,
                format!("missing required argument `{}`", render_arg(arg)),
            ),
            Self::MissingGroup { group, span } => ParseError::new(
                ParseErrorKind::MissingGroup,
                span,
                format!("missing required group `{}`", render_group(group)),
            ),
            Self::Conflict { left, right, span } => ParseError::new(
                ParseErrorKind::Conflict,
                span,
                format!("argument `{}` conflicts with `{}`", render_arg(left), render_arg(right)),
            ),
            Self::Requires { arg, required } => ParseError::new(
                ParseErrorKind::Requires,
                None,
                format!("argument `{}` requires `{}`", render_arg(arg), render_arg(required)),
            ),
            Self::ValidationError { arg, span, message } => ParseError::new(
                ParseErrorKind::ValidationFailed,
                Some(span),
                format!("invalid value for `{}`: {}", render_arg(arg), message),
            ),
            Self::ArityMismatch { arg, span, found, min, max } => {
                let expected = match max {
                    Some(m) if min == m => format!("exactly {min}"),
                    Some(m) => format!("between {min} and {m}"),
                    None => format!("at least {min}"),
                };
                ParseError::new(
                    ParseErrorKind::ArityMismatch,
                    span,
                    format!(
                        "argument `{}` expects {expected} values, but found {found}",
                        render_arg(arg)
                    ),
                )
            }
        }
    }
}
