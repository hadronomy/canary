//! Build-time schema compilation errors.
//!
//! This module defines errors produced while lowering authoring-time builders
//! into the immutable compiled command schema.
//!
//! The design aims to provide both:
//!
//! - a machine-readable category via [`BuildErrorKind`]
//! - a human-readable diagnostic via [`BuildError`]
//!
//! Typical compiler-side usage:
//!
//! ```rust,ignore
//! return Err(BuildError::new(
//!     BuildErrorKind::DuplicateLong,
//!     "acme build",
//!     "duplicate long option `--release`",
//! ));
//! ```
//!
//! Typical library-side handling:
//!
//! ```rust,ignore
//! match builder.build() {
//!     Ok(command) => {
//!         // use compiled schema
//!     }
//!     Err(err) => {
//!         eprintln!("{err}");
//!
//!         match err.kind() {
//!             BuildErrorKind::DuplicateLong => {
//!                 // maybe add specialized reporting
//!             }
//!             _ => {}
//!         }
//!     }
//! }
//! ```

use thiserror::Error;

/// Error produced while compiling a command schema.
///
/// A `BuildError` contains:
///
/// - a stable machine-readable [`BuildErrorKind`]
/// - an optional human-readable path identifying where the issue occurred
/// - a concrete message describing the problem
///
/// The `path` is intended to be friendly to humans, for example:
///
/// - `"acme"`
/// - `"acme build"`
/// - `"acme build --release"`
///
/// It is not intended to be a structured query language; it is diagnostic
/// context.
///
/// # Display format
///
/// If a path is present:
///
/// ```text
/// duplicate long option at acme build: duplicate long option `--release`
/// ```
///
/// If no path is present:
///
/// ```text
/// duplicate long option: duplicate long option `--release`
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error(
    "{kind}{path_prefix}: {message}",
    path_prefix = self.path_prefix()
)]
pub struct BuildError {
    kind: BuildErrorKind,
    path: Box<str>,
    message: Box<str>,
}

impl BuildError {
    /// Create a new build error with a kind, path, and message.
    ///
    /// This is the most general constructor and is the one most compiler code
    /// should use.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let err = BuildError::new(
    ///     BuildErrorKind::DuplicateShort,
    ///     "acme build",
    ///     "duplicate short option `-v`",
    /// );
    /// ```
    #[must_use]
    pub fn new(
        kind: BuildErrorKind,
        path: impl Into<Box<str>>,
        message: impl Into<Box<str>>,
    ) -> Self {
        Self { kind, path: path.into(), message: message.into() }
    }

    /// Create a new build error without path context.
    ///
    /// This is convenient for truly global validation failures that are not tied
    /// to a particular command path.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let err = BuildError::without_path(
    ///     BuildErrorKind::LimitExceeded,
    ///     "schema exceeded implementation limits",
    /// );
    /// ```
    #[must_use]
    pub fn without_path(kind: BuildErrorKind, message: impl Into<Box<str>>) -> Self {
        Self { kind, path: Box::<str>::from(""), message: message.into() }
    }

    /// Return the machine-readable category of this error.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if err.kind() == BuildErrorKind::DuplicateLong {
    ///     // specialized handling
    /// }
    /// ```
    #[must_use]
    pub fn kind(&self) -> BuildErrorKind {
        self.kind
    }

    /// Return the human-readable context path for this error, if any.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// if let Some(path) = err.path() {
    ///     eprintln!("while compiling {path}");
    /// }
    /// ```
    #[must_use]
    pub fn path(&self) -> Option<&str> {
        if self.path.is_empty() { None } else { Some(&self.path) }
    }

    /// Return the error's human-readable message.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// eprintln!("details: {}", err.message());
    /// ```
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Return a copy of this error with a different path.
    ///
    /// This is occasionally useful when enriching lower-level validation errors
    /// with higher-level path context.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let err = err.with_path("acme build");
    /// ```
    #[must_use]
    pub fn with_path(mut self, path: impl Into<Box<str>>) -> Self {
        self.path = path.into();
        self
    }

    /// Return a copy of this error with a different message.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let err = err.with_message("duplicate long option `--release`");
    /// ```
    #[must_use]
    pub fn with_message(mut self, message: impl Into<Box<str>>) -> Self {
        self.message = message.into();
        self
    }

    /// Return a copy of this error with a different kind.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let err = err.with_kind(BuildErrorKind::InvalidRelation);
    /// ```
    #[must_use]
    pub fn with_kind(mut self, kind: BuildErrorKind) -> Self {
        self.kind = kind;
        self
    }

    #[doc(hidden)]
    #[must_use]
    pub fn path_prefix(&self) -> &str {
        if self.path.is_empty() { "" } else { " at " }
    }
}

/// Structured category of build-time schema failure.
///
/// This enum is intended to be stable and machine-readable, so callers can
/// inspect the broad class of error without string matching.
///
/// The variants are intentionally high-level. The detailed, human-oriented
/// explanation belongs in [`BuildError::message`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum BuildErrorKind {
    /// A command name, subcommand name, or alias collided.
    DuplicateName,

    /// A short option collided within a command's effective view.
    DuplicateShort,

    /// A long option collided within a command's effective view.
    DuplicateLong,

    /// A referenced command-local or symbolic entity could not be resolved.
    UnknownReference,

    /// A declared relationship is invalid for the target it references.
    InvalidRelation,

    /// Positional arguments were declared in an invalid layout.
    InvalidPositionalLayout,

    /// An implementation or representational limit was exceeded.
    LimitExceeded,

    /// A declared default value is incompatible with its value specification.
    InvalidDefault,
}

impl BuildErrorKind {
    /// Return a short human-readable label for this error kind.
    ///
    /// This string is suitable for diagnostics and logging.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// eprintln!("schema build failed: {}", err.kind().as_str());
    /// ```
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DuplicateName => "duplicate name",
            Self::DuplicateShort => "duplicate short option",
            Self::DuplicateLong => "duplicate long option",
            Self::UnknownReference => "unknown reference",
            Self::InvalidRelation => "invalid relation",
            Self::InvalidPositionalLayout => "invalid positional layout",
            Self::LimitExceeded => "schema limit exceeded",
            Self::InvalidDefault => "invalid default value",
        }
    }
}

impl std::fmt::Display for BuildErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_without_path_is_clean() {
        let err = BuildError::without_path(
            BuildErrorKind::DuplicateLong,
            "duplicate long option `--release`",
        );

        assert_eq!(err.to_string(), "duplicate long option: duplicate long option `--release`");
    }

    #[test]
    fn display_with_path_is_clean() {
        let err = BuildError::new(
            BuildErrorKind::DuplicateLong,
            "acme build",
            "duplicate long option `--release`",
        );

        assert_eq!(
            err.to_string(),
            "duplicate long option at acme build: duplicate long option `--release`"
        );
    }

    #[test]
    fn kind_accessor_returns_stable_category() {
        let err = BuildError::new(
            BuildErrorKind::UnknownReference,
            "acme test",
            "unknown target `verbose` in relation",
        );

        assert_eq!(err.kind(), BuildErrorKind::UnknownReference);
    }

    #[test]
    fn path_accessor_omits_empty_path() {
        let err =
            BuildError::without_path(BuildErrorKind::LimitExceeded, "too many effective args");

        assert_eq!(err.path(), None);
    }

    #[test]
    fn path_accessor_returns_non_empty_path() {
        let err = BuildError::new(
            BuildErrorKind::InvalidPositionalLayout,
            "acme build",
            "first explicit positional index must be 0",
        );

        assert_eq!(err.path(), Some("acme build"));
    }

    #[test]
    fn builder_style_replacement_helpers_work() {
        let err = BuildError::without_path(BuildErrorKind::DuplicateName, "duplicate subcommand")
            .with_path("acme")
            .with_message("duplicate subcommand `build`")
            .with_kind(BuildErrorKind::DuplicateLong);

        assert_eq!(err.kind(), BuildErrorKind::DuplicateLong);
        assert_eq!(err.path(), Some("acme"));
        assert_eq!(err.message(), "duplicate subcommand `build`");
    }

    #[test]
    fn error_kind_labels_are_stable() {
        assert_eq!(BuildErrorKind::DuplicateName.as_str(), "duplicate name");
        assert_eq!(BuildErrorKind::DuplicateShort.as_str(), "duplicate short option");
        assert_eq!(BuildErrorKind::DuplicateLong.as_str(), "duplicate long option");
        assert_eq!(BuildErrorKind::UnknownReference.as_str(), "unknown reference");
        assert_eq!(BuildErrorKind::InvalidRelation.as_str(), "invalid relation");
        assert_eq!(BuildErrorKind::InvalidPositionalLayout.as_str(), "invalid positional layout");
        assert_eq!(BuildErrorKind::LimitExceeded.as_str(), "schema limit exceeded");
        assert_eq!(BuildErrorKind::InvalidDefault.as_str(), "invalid default value");
    }
}
