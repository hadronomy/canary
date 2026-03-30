//! Rich schema build diagnostics with Ariadne integration.
//!
//! This module builds on top of [`crate::error::BuildError`] by adding optional
//! source spans, labels, notes, and help text.
//!
//! The intent is to keep the semantic error model simple and stable:
//!
//! - [`crate::error::BuildError`] is the core domain error
//! - [`BuildDiagnostic`] is the richer presentation-oriented form
//!
//! This separation is useful because not every caller wants or needs rich
//! terminal diagnostics, while compiler and tooling paths often do.
//!
//! # Design overview
//!
//! A [`BuildDiagnostic`] contains:
//!
//! - a required [`crate::error::BuildError`]
//! - an optional error code
//! - an optional primary label
//! - zero or more secondary labels
//! - zero or more notes
//! - an optional help message
//!
//! Labels point into named sources tracked by [`SourceStore`], which implements
//! Ariadne's cache API.
//!
//! # Typical usage
//!
//! ```rust,ignore
//! use crate::diagnostic::{BuildDiagnostic, SourceStore};
//! use crate::error::{BuildError, BuildErrorKind};
//!
//! let mut sources = SourceStore::new();
//! let source_id = sources.insert(
//!     "builder://acme",
//!     "\
//! command acme
//!   arg release: --release
//!   arg release_dup: --release
//! ",
//! );
//!
//! let diagnostic = BuildDiagnostic::from_error(BuildError::new(
//!     BuildErrorKind::DuplicateLong,
//!     "acme",
//!     "duplicate long option `--release`",
//! ))
//! .with_code("orbit::schema::duplicate_long")
//! .with_primary_label(source_id.clone(), 49..58, "redefined here")
//! .with_secondary_label(source_id.clone(), 29..38, "first defined here")
//! .with_help("rename or remove one of the conflicting options");
//!
//! diagnostic.eprint(&mut sources)?;
//! # Ok::<(), crate::diagnostic::DiagnosticEmitError>(())
//! ```
//!
//! # Plain-text fallback
//!
//! A diagnostic can always be rendered without source context:
//!
//! ```rust
//! # use crate::diagnostic::BuildDiagnostic;
//! # use crate::error::{BuildError, BuildErrorKind};
//! let diagnostic = BuildDiagnostic::from_error(BuildError::new(
//!     BuildErrorKind::InvalidRelation,
//!     "acme build",
//!     "flag arguments cannot carry a value spec",
//! ))
//! .with_note("flags are presence-only arguments")
//! .with_help("use `ArgBuilder::option(...)` for named values");
//!
//! let text = diagnostic.render_plain();
//! assert!(text.contains("invalid relation at acme build"));
//! assert!(text.contains("note: flags are presence-only arguments"));
//! assert!(text.contains("help: use `ArgBuilder::option(...)` for named values"));
//! ```

use std::collections::HashMap;
use std::fmt;
use std::io::{self, Write};
use std::ops::Range;
use std::sync::Arc;

use ariadne::{Cache, Color, Label, Report, ReportKind, Source};
use thiserror::Error;

use crate::diagnostic;
use crate::error::{BuildError, BuildErrorKind};

/// Opaque source identifier used by rich diagnostics.
///
/// A `SourceId` names a source known to [`SourceStore`]. It may represent:
///
/// - a real file path
/// - a generated virtual source for builder-defined schemas
/// - a derive-generated pseudo-source
///
/// The identifier is only a name; the source text itself lives in
/// [`SourceStore`].
///
/// # Examples
///
/// ```rust
/// # use crate::diagnostic::SourceId;
/// let id = SourceId::new("builder://acme");
/// assert_eq!(id.as_str(), "builder://acme");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SourceId(Arc<str>);

impl SourceId {
    /// Create a new source identifier.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::SourceId;
    /// let id = SourceId::new("schema://example");
    /// assert_eq!(id.as_str(), "schema://example");
    /// ```
    #[must_use]
    pub fn new(id: impl Into<Arc<str>>) -> Self {
        Self(id.into())
    }

    /// Borrow the underlying identifier as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SourceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for SourceId {
    fn from(value: &str) -> Self {
        Self::new(Arc::<str>::from(value))
    }
}

impl From<String> for SourceId {
    fn from(value: String) -> Self {
        Self::new(Arc::<str>::from(value))
    }
}

impl From<Arc<str>> for SourceId {
    fn from(value: Arc<str>) -> Self {
        Self::new(value)
    }
}

/// In-memory source storage for rich diagnostics.
///
/// `SourceStore` owns the text that labels refer to and implements
/// [`ariadne::Cache`] so it can be passed directly to Ariadne rendering.
///
/// This store works well for:
///
/// - real files loaded into memory
/// - virtual builder sources
/// - test fixtures
///
/// # Examples
///
/// ```rust
/// # use crate::diagnostic::SourceStore;
/// let mut sources = SourceStore::new();
///
/// let id = sources.insert("builder://demo", "arg release: --release");
/// assert!(sources.contains(&id));
/// ```
#[derive(Debug, Default, Clone)]
pub struct SourceStore {
    sources: HashMap<SourceId, Source<String>>,
}

impl SourceStore {
    /// Create an empty source store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a source text under the given source id and return that id.
    ///
    /// If an entry with the same id already exists, it is replaced.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::{SourceId, SourceStore};
    /// let mut sources = SourceStore::new();
    ///
    /// let id = sources.insert("builder://demo", "arg v: --verbose");
    /// assert_eq!(id, SourceId::new("builder://demo"));
    /// ```
    pub fn insert(&mut self, id: impl Into<SourceId>, text: impl Into<String>) -> SourceId {
        let id = id.into();
        self.sources.insert(id.clone(), Source::from(text.into()));
        id
    }

    /// Return `true` if the store contains a source for `id`.
    #[must_use]
    pub fn contains(&self, id: &SourceId) -> bool {
        self.sources.contains_key(id)
    }

    /// Return the number of stored sources.
    #[must_use]
    pub fn len(&self) -> usize {
        self.sources.len()
    }

    /// Return `true` if the store is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

impl Cache<SourceId> for SourceStore {
    type Storage = String;

    fn fetch(
        &mut self,
        id: &SourceId,
    ) -> std::result::Result<
        &ariadne::Source<<Self as ariadne::Cache<diagnostic::SourceId>>::Storage>,
        impl std::fmt::Debug,
    > {
        self.sources.get(id).ok_or_else(|| {
            Box::new(format!("missing diagnostic source `{id}`")) as Box<dyn fmt::Debug>
        })
    }

    fn display<'a>(&self, id: &'a SourceId) -> std::option::Option<impl std::fmt::Display + 'a> {
        Some(Box::new(id.clone()))
    }
}

/// A labeled span attached to a [`BuildDiagnostic`].
///
/// Labels are used by Ariadne to point to relevant source ranges.
///
/// A label may be:
///
/// - primary: the main error site
/// - secondary: additional related sites
///
/// # Examples
///
/// ```rust
/// # use crate::diagnostic::{DiagnosticLabel, SourceId};
/// let label = DiagnosticLabel::primary(
///     SourceId::new("builder://demo"),
///     10..20,
///     "duplicate option defined here",
/// );
///
/// assert!(label.is_primary());
/// assert_eq!(label.range(), &(10..20));
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticLabel {
    source: SourceId,
    range: Range<usize>,
    message: Box<str>,
    primary: bool,
}

impl DiagnosticLabel {
    /// Create a new primary label.
    #[must_use]
    pub fn primary(source: SourceId, range: Range<usize>, message: impl Into<Box<str>>) -> Self {
        Self { source, range, message: message.into(), primary: true }
    }

    /// Create a new secondary label.
    #[must_use]
    pub fn secondary(source: SourceId, range: Range<usize>, message: impl Into<Box<str>>) -> Self {
        Self { source, range, message: message.into(), primary: false }
    }

    /// Return the source referenced by this label.
    #[must_use]
    pub fn source(&self) -> &SourceId {
        &self.source
    }

    /// Return the byte range referenced by this label.
    #[must_use]
    pub fn range(&self) -> &Range<usize> {
        &self.range
    }

    /// Return the label message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Return `true` if this is the primary label.
    #[must_use]
    pub fn is_primary(&self) -> bool {
        self.primary
    }
}

/// Rich diagnostic for schema build failures.
///
/// This type enriches a core [`BuildError`] with optional rendering metadata.
///
/// The recommended flow is:
///
/// 1. create a semantic [`BuildError`]
/// 2. wrap it with [`BuildDiagnostic::from_error`]
/// 3. attach labels, notes, and help text as available
/// 4. render with [`eprint`](Self::eprint), [`print`](Self::print), or
///    [`render_plain`](Self::render_plain)
///
/// # Examples
///
/// ```rust
/// # use crate::diagnostic::{BuildDiagnostic, SourceStore};
/// # use crate::error::{BuildError, BuildErrorKind};
/// let diagnostic = BuildDiagnostic::from_error(BuildError::new(
///     BuildErrorKind::DuplicateName,
///     "acme",
///     "duplicate subcommand name `build`",
/// ))
/// .with_code("orbit::schema::duplicate_name")
/// .with_note("subcommand names and aliases share one namespace")
/// .with_help("rename one of the conflicting subcommands");
///
/// assert_eq!(diagnostic.kind(), BuildErrorKind::DuplicateName);
/// assert!(diagnostic.render_plain().contains("duplicate name at acme"));
/// ```
#[derive(Debug, Clone)]
pub struct BuildDiagnostic {
    error: BuildError,
    code: Option<Box<str>>,
    primary: Option<DiagnosticLabel>,
    secondary: Box<[DiagnosticLabel]>,
    notes: Box<[Box<str>]>,
    help: Option<Box<str>>,
}

impl BuildDiagnostic {
    /// Create a new rich diagnostic from a semantic build error.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::BuildDiagnostic;
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::new(
    ///     BuildErrorKind::UnknownReference,
    ///     "acme build",
    ///     "unknown target `verbose` in relation",
    /// ));
    ///
    /// assert_eq!(diagnostic.kind(), BuildErrorKind::UnknownReference);
    /// ```
    #[must_use]
    pub fn from_error(error: BuildError) -> Self {
        Self {
            error,
            code: None,
            primary: None,
            secondary: Box::new([]),
            notes: Box::new([]),
            help: None,
        }
    }

    /// Return the underlying semantic build error.
    #[must_use]
    pub fn error(&self) -> &BuildError {
        &self.error
    }

    /// Return the machine-readable error kind.
    #[must_use]
    pub fn kind(&self) -> BuildErrorKind {
        self.error.kind()
    }

    /// Return the human-readable path context, if any.
    #[must_use]
    pub fn path(&self) -> Option<&str> {
        self.error.path()
    }

    /// Return the human-readable message.
    #[must_use]
    pub fn message(&self) -> &str {
        self.error.message()
    }

    /// Return the optional diagnostic code.
    #[must_use]
    pub fn code(&self) -> Option<&str> {
        self.code.as_deref()
    }

    /// Return the primary label, if present.
    #[must_use]
    pub fn primary_label(&self) -> Option<&DiagnosticLabel> {
        self.primary.as_ref()
    }

    /// Return the secondary labels.
    #[must_use]
    pub fn secondary_labels(&self) -> &[DiagnosticLabel] {
        &self.secondary
    }

    /// Return all note messages.
    #[must_use]
    pub fn notes(&self) -> &[Box<str>] {
        &self.notes
    }

    /// Return the optional help message.
    #[must_use]
    pub fn help(&self) -> Option<&str> {
        self.help.as_deref()
    }

    /// Return `true` if the diagnostic has at least one source label.
    #[must_use]
    pub fn has_labels(&self) -> bool {
        self.primary.is_some() || !self.secondary.is_empty()
    }

    /// Attach an optional diagnostic code.
    ///
    /// Codes are helpful for documentation, logs, and machine-facing tools.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::BuildDiagnostic;
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::LimitExceeded,
    ///     "too many effective args",
    /// ))
    /// .with_code("orbit::schema::limit_exceeded");
    ///
    /// assert_eq!(diagnostic.code(), Some("orbit::schema::limit_exceeded"));
    /// ```
    #[must_use]
    pub fn with_code(mut self, code: impl Into<Box<str>>) -> Self {
        self.code = Some(code.into());
        self
    }

    /// Attach or replace the primary label.
    ///
    /// If a primary label already exists, it is replaced.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::{BuildDiagnostic, SourceId};
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let source = SourceId::new("builder://demo");
    ///
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::DuplicateLong,
    ///     "duplicate long option `--release`",
    /// ))
    /// .with_primary_label(source, 10..19, "redefined here");
    ///
    /// assert!(diagnostic.primary_label().is_some());
    /// ```
    #[must_use]
    pub fn with_primary_label(
        mut self,
        source: SourceId,
        range: Range<usize>,
        message: impl Into<Box<str>>,
    ) -> Self {
        self.primary = Some(DiagnosticLabel::primary(source, range, message));
        self
    }

    /// Add a secondary label.
    ///
    /// Secondary labels are useful for cross-references such as "first defined
    /// here" or "required by this relation".
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::{BuildDiagnostic, SourceId};
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let source = SourceId::new("builder://demo");
    ///
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::DuplicateLong,
    ///     "duplicate long option `--release`",
    /// ))
    /// .with_secondary_label(source, 0..9, "first defined here");
    ///
    /// assert_eq!(diagnostic.secondary_labels().len(), 1);
    /// ```
    #[must_use]
    pub fn with_secondary_label(
        mut self,
        source: SourceId,
        range: Range<usize>,
        message: impl Into<Box<str>>,
    ) -> Self {
        let mut labels = self.secondary.into_vec();
        labels.push(DiagnosticLabel::secondary(source, range, message));
        self.secondary = labels.into_boxed_slice();
        self
    }

    /// Add a free-form note.
    ///
    /// Notes are rendered after the main diagnostic body.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::BuildDiagnostic;
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::InvalidDefault,
    ///     "default value is incompatible with parser kind",
    /// ))
    /// .with_note("default values are validated during schema compilation");
    ///
    /// assert_eq!(diagnostic.notes().len(), 1);
    /// ```
    #[must_use]
    pub fn with_note(mut self, note: impl Into<Box<str>>) -> Self {
        let mut notes = self.notes.into_vec();
        notes.push(note.into());
        self.notes = notes.into_boxed_slice();
        self
    }

    /// Attach optional help text.
    ///
    /// Help text is intended to suggest a fix, not restate the error.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::BuildDiagnostic;
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::InvalidRelation,
    ///     "positional arguments cannot have long names",
    /// ))
    /// .with_help("remove the long name or change the argument kind to `Option`");
    ///
    /// assert!(diagnostic.help().is_some());
    /// ```
    #[must_use]
    pub fn with_help(mut self, help: impl Into<Box<str>>) -> Self {
        self.help = Some(help.into());
        self
    }

    /// Render the diagnostic as plain text without source snippets.
    ///
    /// This works even when no labels or sources are available.
    ///
    /// The output includes:
    ///
    /// - the core error line
    /// - the diagnostic code, if present
    /// - notes, if any
    /// - help text, if present
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use crate::diagnostic::BuildDiagnostic;
    /// # use crate::error::{BuildError, BuildErrorKind};
    /// let text = BuildDiagnostic::from_error(BuildError::without_path(
    ///     BuildErrorKind::DuplicateShort,
    ///     "duplicate short option `-v`",
    /// ))
    /// .with_code("orbit::schema::duplicate_short")
    /// .with_help("choose a different short name for one of the arguments")
    /// .render_plain();
    ///
    /// assert!(text.contains("duplicate short option"));
    /// assert!(text.contains("code: orbit::schema::duplicate_short"));
    /// assert!(text.contains("help: choose a different short name"));
    /// ```
    #[must_use]
    pub fn render_plain(&self) -> String {
        let mut out = String::new();
        out.push_str(&self.error.to_string());

        if let Some(code) = &self.code {
            out.push_str("\ncode: ");
            out.push_str(code);
        }

        for note in &*self.notes {
            out.push_str("\nnote: ");
            out.push_str(note);
        }

        if let Some(help) = &self.help {
            out.push_str("\nhelp: ");
            out.push_str(help);
        }

        out
    }

    /// Print the diagnostic to stdout.
    ///
    /// If labels are present, this uses Ariadne and requires every referenced
    /// source to be present in `sources`.
    ///
    /// If no labels are present, this falls back to plain-text output.
    ///
    /// # Errors
    ///
    /// Returns [`DiagnosticEmitError`] if:
    ///
    /// - a referenced source is missing
    /// - stdout output fails
    pub fn print(&self, sources: &mut SourceStore) -> Result<(), DiagnosticEmitError> {
        self.emit(sources, Stream::Stdout)
    }

    /// Print the diagnostic to stderr.
    ///
    /// If labels are present, this uses Ariadne and requires every referenced
    /// source to be present in `sources`.
    ///
    /// If no labels are present, this falls back to plain-text output.
    ///
    /// # Errors
    ///
    /// Returns [`DiagnosticEmitError`] if:
    ///
    /// - a referenced source is missing
    /// - stderr output fails
    pub fn eprint(&self, sources: &mut SourceStore) -> Result<(), DiagnosticEmitError> {
        self.emit(sources, Stream::Stderr)
    }

    fn emit(&self, sources: &mut SourceStore, stream: Stream) -> Result<(), DiagnosticEmitError> {
        if !self.has_labels() {
            return self.emit_plain(stream);
        }

        self.ensure_sources_present(sources)?;

        let anchor = self
            .primary
            .as_ref()
            .or_else(|| self.secondary.first())
            .expect("has_labels() ensured that at least one label exists");

        let mut report =
            Report::build(ReportKind::Error, (anchor.source.clone(), anchor.range.clone()));

        if let Some(code) = &self.code {
            report = report.with_code(code.as_ref());
        }

        if let Some(primary) = &self.primary {
            report = report.with_label(
                Label::new((primary.source.clone(), primary.range.clone()))
                    .with_message(primary.message.as_ref())
                    .with_color(Color::Red),
            );
        }

        for secondary in &*self.secondary {
            report = report.with_label(
                Label::new((secondary.source.clone(), secondary.range.clone()))
                    .with_message(secondary.message.as_ref())
                    .with_color(Color::Yellow),
            );
        }

        for note in &*self.notes {
            report = report.with_note(note.as_ref());
        }

        if let Some(help) = &self.help {
            report = report.with_help(help.as_ref());
        }

        let report = report.finish();

        match stream {
            Stream::Stdout => report.print(sources)?,
            Stream::Stderr => report.eprint(sources)?,
        }

        Ok(())
    }

    fn emit_plain(&self, stream: Stream) -> Result<(), DiagnosticEmitError> {
        let text = self.render_plain();

        match stream {
            Stream::Stdout => {
                let mut stdout = io::stdout().lock();
                writeln!(stdout, "{text}")?;
            }
            Stream::Stderr => {
                let mut stderr = io::stderr().lock();
                writeln!(stderr, "{text}")?;
            }
        }

        Ok(())
    }

    fn ensure_sources_present(&self, sources: &SourceStore) -> Result<(), DiagnosticEmitError> {
        if let Some(primary) = &self.primary
            && !sources.contains(&primary.source)
        {
            return Err(DiagnosticEmitError::MissingSource { id: primary.source.clone() });
        }

        for label in &*self.secondary {
            if !sources.contains(&label.source) {
                return Err(DiagnosticEmitError::MissingSource { id: label.source.clone() });
            }
        }

        Ok(())
    }
}

impl From<BuildError> for BuildDiagnostic {
    fn from(error: BuildError) -> Self {
        Self::from_error(error)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stream {
    Stdout,
    Stderr,
}

/// Error produced while emitting a rich diagnostic.
///
/// This is distinct from [`BuildError`]:
///
/// - [`BuildError`] describes a schema problem
/// - `DiagnosticEmitError` describes a rendering/output problem
#[derive(Debug, Error)]
pub enum DiagnosticEmitError {
    /// A label referenced a source id that was not present in the source store.
    #[error("missing diagnostic source `{id}`")]
    MissingSource {
        /// The missing source id.
        id: SourceId,
    },

    /// Writing the rendered report failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{BuildError, BuildErrorKind};

    #[test]
    fn source_store_insert_and_contains_work() {
        let mut sources = SourceStore::new();
        let id = sources.insert("builder://demo", "arg verbose: --verbose");

        assert!(sources.contains(&id));
        assert_eq!(sources.len(), 1);
        assert!(!sources.is_empty());
    }

    #[test]
    fn plain_render_includes_core_fields() {
        let diagnostic = BuildDiagnostic::from_error(BuildError::new(
            BuildErrorKind::DuplicateLong,
            "acme build",
            "duplicate long option `--release`",
        ))
        .with_code("orbit::schema::duplicate_long")
        .with_note("long names must be unique within a command view")
        .with_help("rename or remove one of the conflicting arguments");

        let text = diagnostic.render_plain();

        assert!(
            text.contains("duplicate long option at acme build: duplicate long option `--release`")
        );
        assert!(text.contains("code: orbit::schema::duplicate_long"));
        assert!(text.contains("note: long names must be unique within a command view"));
        assert!(text.contains("help: rename or remove one of the conflicting arguments"));
    }

    #[test]
    fn labels_are_recorded_correctly() {
        let source = SourceId::new("builder://demo");

        let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
            BuildErrorKind::DuplicateShort,
            "duplicate short option `-v`",
        ))
        .with_primary_label(source.clone(), 10..12, "redefined here")
        .with_secondary_label(source, 0..2, "first defined here");

        assert!(diagnostic.has_labels());
        assert!(diagnostic.primary_label().is_some());
        assert_eq!(diagnostic.secondary_labels().len(), 1);
        assert!(diagnostic.primary_label().expect("primary label should be present").is_primary());
    }

    #[test]
    fn missing_sources_are_detected_before_emission() {
        let mut sources = SourceStore::new();

        let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
            BuildErrorKind::DuplicateName,
            "duplicate subcommand name `build`",
        ))
        .with_primary_label(SourceId::new("builder://missing"), 0..5, "redefined here");

        let err = diagnostic.print(&mut sources).expect_err("expected missing source error");

        match err {
            DiagnosticEmitError::MissingSource { id } => {
                assert_eq!(id.as_str(), "builder://missing");
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn plain_emission_works_without_labels() {
        let mut sources = SourceStore::new();

        let diagnostic = BuildDiagnostic::from_error(BuildError::without_path(
            BuildErrorKind::InvalidRelation,
            "flag arguments cannot carry a value spec",
        ));

        diagnostic.print(&mut sources).expect("plain emission should succeed");
    }
}
