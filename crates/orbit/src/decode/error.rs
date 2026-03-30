//! Decode-time errors.
//!
//! These errors are produced when converting raw parse results into typed Rust
//! values.

use thiserror::Error;

use crate::parse::Span;

/// Error produced while decoding typed values from raw parse output.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub struct DecodeError {
    kind: DecodeErrorKind,
    arg: Option<Box<str>>,
    span: Option<Span>,
    message: Box<str>,
}

impl DecodeError {
    /// Create a new decode error.
    #[must_use]
    pub fn new(
        kind: DecodeErrorKind,
        arg: Option<impl Into<Box<str>>>,
        span: Option<Span>,
        message: impl Into<Box<str>>,
    ) -> Self {
        Self { kind, arg: arg.map(Into::into), span, message: message.into() }
    }

    /// Return the error kind.
    #[must_use]
    pub fn kind(&self) -> DecodeErrorKind {
        self.kind
    }

    /// Return the arg id, if known.
    #[must_use]
    pub fn arg(&self) -> Option<&str> {
        self.arg.as_deref()
    }

    /// Return the originating span, if known.
    #[must_use]
    pub fn span(&self) -> Option<Span> {
        self.span
    }

    /// Return the human-readable message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Return a copy of this error with arg context attached.
    #[must_use]
    pub fn with_arg(mut self, arg: impl Into<Box<str>>) -> Self {
        self.arg = Some(arg.into());
        self
    }

    /// Return a copy of this error with span context attached.
    #[must_use]
    pub fn with_span(mut self, span: Span) -> Self {
        self.span = Some(span);
        self
    }
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (self.arg(), self.span()) {
            (Some(arg), Some(span)) => write!(
                f,
                "{} for `{}` at argv[{}]: {}",
                self.kind, arg, span.arg_index, self.message
            ),
            (Some(arg), None) => {
                write!(f, "{} for `{}`: {}", self.kind, arg, self.message)
            }
            (None, Some(span)) => {
                write!(f, "{} at argv[{}]: {}", self.kind, span.arg_index, self.message)
            }
            (None, None) => write!(f, "{}: {}", self.kind, self.message),
        }
    }
}

/// Category of decode-time failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum DecodeErrorKind {
    /// The requested arg does not exist in the matched command view.
    UnknownArg,
    /// The arg occurred more than once when a single value was expected.
    TooManyOccurrences,
    /// The occurrence carried too many values for the requested decode shape.
    TooManyValues,
    /// The arg was present but carried no value where one was expected.
    MissingValue,
    /// The value was not valid UTF-8.
    NonUtf8,
    /// The value could not be parsed as the target type.
    InvalidValue,
    /// The requested operation is incompatible with the arg/action shape.
    InvalidAccess,
    /// A semantic validator rejected the value.
    ValidationFailed,
}

impl DecodeErrorKind {
    /// Return a short human-readable label.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnknownArg => "unknown argument",
            Self::TooManyOccurrences => "too many occurrences",
            Self::TooManyValues => "too many values",
            Self::MissingValue => "missing value",
            Self::NonUtf8 => "non-utf8 value",
            Self::InvalidValue => "invalid value",
            Self::InvalidAccess => "invalid access",
            Self::ValidationFailed => "validation failed",
        }
    }
}

impl std::fmt::Display for DecodeErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
