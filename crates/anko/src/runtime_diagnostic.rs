//! Rich runtime diagnostics rendered with Ariadne by default.
//!
//! This module turns a [`RuntimeError`] into a presentation-oriented diagnostic
//! that can be printed to stdout or stderr.
//!
//! When span information points into real CLI input, diagnostics are rendered
//! against a reconstructed argv source so Ariadne can highlight the relevant
//! region. When the span is synthetic (for example, a default value or an
//! environment-provided value), a synthetic source is rendered instead.

use std::borrow::Cow;
use std::io;
use std::io::Write;
use std::ops::Range;
use std::path::Path;

use ariadne::{Color, Label, Report, ReportKind, Source};
use thiserror::Error;

use crate::decode::DecodeError;
use crate::parse::{ParseError, Span, SpanPart};
use crate::runtime_error::{ArgvSnapshot, RuntimeError};

/// Rich runtime diagnostic.
///
/// This is the presentation-oriented form of a [`RuntimeError`]. It retains the
/// original error and, when available, an argv snapshot that can be used to
/// reconstruct user input for highlighted diagnostics.
#[derive(Debug, Clone)]
pub struct RuntimeDiagnostic {
    error: RuntimeError,
    argv: Option<ArgvSnapshot>,
}

impl RuntimeDiagnostic {
    /// Creates a runtime diagnostic from a runtime error and optional argv snapshot.
    #[must_use]
    pub fn new(error: RuntimeError, argv: Option<ArgvSnapshot>) -> Self {
        Self { error, argv }
    }

    /// Returns the underlying runtime error.
    #[must_use]
    pub fn error(&self) -> &RuntimeError {
        &self.error
    }

    /// Returns the argv snapshot, if any.
    #[must_use]
    pub fn argv(&self) -> Option<&ArgvSnapshot> {
        self.argv.as_ref()
    }

    /// Prints this diagnostic to stderr.
    ///
    /// Ariadne rendering is used when span information can be associated with a
    /// rendered source; otherwise a plain-text fallback is emitted.
    pub fn eprint(&self) -> Result<(), RuntimeEmitError> {
        self.emit(Stream::Stderr)
    }

    /// Prints this diagnostic to stdout.
    ///
    /// Ariadne rendering is used when span information can be associated with a
    /// rendered source; otherwise a plain-text fallback is emitted.
    pub fn print(&self) -> Result<(), RuntimeEmitError> {
        self.emit(Stream::Stdout)
    }

    fn emit(&self, stream: Stream) -> Result<(), RuntimeEmitError> {
        match &self.error {
            RuntimeError::Parse(errors) => {
                for error in errors {
                    emit_parse_error(error, self.argv.as_ref(), stream)?;
                }
                Ok(())
            }
            RuntimeError::Decode(error) => emit_decode_error(error, self.argv.as_ref(), stream),
            RuntimeError::HelpRequested { .. } => emit_plain("help requested", stream),
        }
    }
}

/// Emits a parse error using either a real argv source or a synthetic source.
fn emit_parse_error(
    err: &ParseError,
    argv: Option<&ArgvSnapshot>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let span = err.span().unwrap_or(Span { arg_index: 0, part: SpanPart::Program });

    if let Some(argv) = argv.filter(|_| !span.part.is_synthetic()) {
        emit_rendered_diagnostic(
            err.to_string(),
            err.message(),
            err.notes(),
            err.help(),
            RealArgvSource::new(argv, span).render(),
            stream,
        )
    } else {
        emit_rendered_diagnostic(
            err.to_string(),
            err.message(),
            err.notes(),
            err.help(),
            SyntheticArgvSource::new(span, None).render(),
            stream,
        )
    }
}

/// Emits a decode error using either a real argv source or a synthetic source.
fn emit_decode_error(
    err: &DecodeError,
    argv: Option<&ArgvSnapshot>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let span = err.span().unwrap_or(Span { arg_index: 0, part: SpanPart::Program });

    if let Some(argv) = argv.filter(|_| !span.part.is_synthetic()) {
        emit_rendered_diagnostic(
            err.to_string(),
            err.message(),
            &[],
            None,
            RealArgvSource::new(argv, span).render(),
            stream,
        )
    } else {
        emit_rendered_diagnostic(
            err.to_string(),
            err.message(),
            &[],
            None,
            SyntheticArgvSource::new(span, err.value()).render(),
            stream,
        )
    }
}

/// Emits a diagnostic from a fully rendered source.
fn emit_rendered_diagnostic(
    title: String,
    label_message: &str,
    notes: &[Box<str>],
    help: Option<&str>,
    rendered: RenderedSource<'_>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let report =
        build_report(rendered.source_id, title, label_message, rendered.range.clone(), notes, help);
    let source = Source::from(rendered.text.into_owned());

    match stream {
        Stream::Stdout => report.print((rendered.source_id, source))?,
        Stream::Stderr => report.eprint((rendered.source_id, source))?,
    }

    Ok(())
}

/// Builds a single Ariadne error report.
fn build_report(
    source_id: &'static str,
    title: String,
    label_message: &str,
    range: Range<usize>,
    notes: &[Box<str>],
    help: Option<&str>,
) -> ariadne::Report<'static, (&'static str, Range<usize>)> {
    let mut report = Report::build(ReportKind::Error, (source_id, range.clone()))
        .with_message(title)
        .with_label(
            Label::new((source_id, range))
                .with_message(label_message.to_owned())
                .with_color(Color::Red),
        );

    for note in notes {
        report = report.with_note(note.as_ref());
    }

    if let Some(help) = help {
        report = report.with_help(help);
    }

    report.finish()
}

/// Emits a plain-text diagnostic.
///
/// This is used for diagnostics that do not benefit from source rendering.
fn emit_plain(text: &str, stream: Stream) -> Result<(), RuntimeEmitError> {
    match stream {
        Stream::Stdout => {
            let mut out = io::stdout().lock();
            writeln!(out, "{text}")?;
        }
        Stream::Stderr => {
            let mut out = io::stderr().lock();
            writeln!(out, "{text}")?;
        }
    }

    Ok(())
}

/// A rendered source together with the range to highlight within it.
#[derive(Debug, Clone)]
struct RenderedSource<'a> {
    source_id: &'static str,
    text: Cow<'a, str>,
    range: Range<usize>,
}

/// Renders a source from a real argv snapshot.
///
/// This reconstructs a command-like string, resolves the span to a byte range
/// inside that string, and then windows the final text so the rendered snippet
/// stays compact while preserving the highlighted region.
#[derive(Debug, Clone, Copy)]
struct RealArgvSource<'a> {
    argv: &'a ArgvSnapshot,
    span: Span,
}

impl<'a> RealArgvSource<'a> {
    const SOURCE_ID: &'static str = "argv://runtime";

    fn new(argv: &'a ArgvSnapshot, span: Span) -> Self {
        Self { argv, span }
    }

    fn render(self) -> RenderedSource<'static> {
        let ReconstructedArgv { mut text, program_range, arg_ranges } = self.reconstruct();
        let range = resolve_real_argv_range(&mut text, program_range, &arg_ranges, self.span);
        let windowed = TextWindow::default().apply_owned(text, range);

        RenderedSource {
            source_id: Self::SOURCE_ID,
            text: Cow::Owned(windowed.text),
            range: windowed.range,
        }
    }

    fn reconstruct(self) -> ReconstructedArgv {
        let mut text = String::with_capacity(self.initial_capacity_hint());

        let program_start = 0;
        if let Some(program) = self.argv.program() {
            let path = Path::new(program.as_os_str());
            let file_name = path.file_name().unwrap_or(program.as_os_str()).to_string_lossy();
            text.push_str(file_name.as_ref());
        } else {
            text.push_str("<command>");
        }
        let program_end = text.len();

        let mut arg_ranges = Vec::new();
        for arg in self.argv.args() {
            text.push(' ');
            let start = text.len();
            arg.display().push_to(&mut text);
            let end = text.len();
            arg_ranges.push(start..end);
        }

        ReconstructedArgv { text, program_range: program_start..program_end, arg_ranges }
    }

    /// Returns a cheap, non-exact allocation hint for reconstructed argv text.
    ///
    /// This intentionally avoids formatting every argument just to predict the
    /// final size.
    fn initial_capacity_hint(self) -> usize {
        let program_len = self
            .argv
            .program()
            .map(|program| {
                Path::new(program.as_os_str())
                    .file_name()
                    .unwrap_or(program.as_os_str())
                    .to_string_lossy()
                    .len()
            })
            .unwrap_or("<command>".len());

        let arg_count = self.argv.args().len();
        program_len + arg_count * 16
    }
}

/// The reconstructed argv text and the ranges of each logical segment within it.
#[derive(Debug, Clone)]
struct ReconstructedArgv {
    text: String,
    program_range: Range<usize>,
    arg_ranges: Vec<Range<usize>>,
}

/// Resolves a span into a byte range within reconstructed argv text.
///
/// When the span cannot be resolved, the entire reconstructed text is used as a
/// conservative fallback.
fn resolve_real_argv_range(
    text: &mut String,
    program_range: Range<usize>,
    arg_ranges: &[Range<usize>],
    span: Span,
) -> Range<usize> {
    match span.part {
        SpanPart::Program => program_range,

        SpanPart::ArgRange { end_index } => {
            let start = arg_ranges.get(span.arg_index as usize).map_or(0, |range| range.start);
            let end = arg_ranges.get(end_index as usize).map_or(text.len(), |range| range.end);
            start..end
        }

        part => {
            if let Some(arg_range) = arg_ranges.get(span.arg_index as usize) {
                let arg_text = &text[arg_range.clone()];
                let local = highlight_range(arg_text, part);
                (arg_range.start + local.start)..(arg_range.start + local.end)
            } else {
                if text.is_empty() {
                    text.push_str("<missing-argv>");
                }
                0..text.len()
            }
        }
    }
}

/// Renders a source for synthetic spans such as defaults or environment values.
#[derive(Debug, Clone, Copy)]
struct SyntheticArgvSource<'a> {
    span: Span,
    synthetic_value: Option<&'a str>,
}

impl<'a> SyntheticArgvSource<'a> {
    fn new(span: Span, synthetic_value: Option<&'a str>) -> Self {
        Self { span, synthetic_value }
    }

    fn render(self) -> RenderedSource<'a> {
        if let Some(value) = self.synthetic_value
            && self.span.part.is_synthetic()
        {
            return RenderedSource {
                source_id: self.span.part.synthetic_source_id(),
                text: Cow::Borrowed(value),
                range: 0..value.len(),
            };
        }

        let placeholder = self.span.part.placeholder();
        let source_id = self.span.part.source_id();

        let (text, range) = match self.span.part {
            SpanPart::Environment
            | SpanPart::Default
            | SpanPart::Program
            | SpanPart::ArgRange { .. } => (Cow::Borrowed(placeholder), 0..placeholder.len()),
            _ => {
                let mut text = String::new();
                text.push_str("argv[");
                text.push_str(&self.span.arg_index.to_string());
                text.push_str("] ");
                let start = text.len();
                text.push_str(placeholder);
                let end = text.len();

                (Cow::Owned(text), start..end)
            }
        };

        RenderedSource { source_id, text, range }
    }
}

/// A compact, windowed view of a larger string.
///
/// The `range` is remapped into `text`, so callers can continue to highlight
/// the same logical region after truncation.
#[derive(Debug, Clone, PartialEq, Eq)]
struct WindowedText {
    text: String,
    range: Range<usize>,
}

/// Windowing policy for long rendered source strings.
///
/// The goal is to keep diagnostics compact without losing the highlighted
/// region or producing awkward UTF-8 splits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TextWindow {
    /// Maximum width before truncation is applied.
    max_width: usize,
    /// Maximum distance for snapping to a nearby word boundary.
    word_snap_distance: usize,
    /// Prefix inserted when the beginning is truncated.
    ellipsis_prefix: &'static str,
    /// Suffix inserted when the end is truncated.
    ellipsis_suffix: &'static str,
    /// Context to preserve on each side when the highlighted range is itself large.
    min_context_when_range_is_large: usize,
}

impl Default for TextWindow {
    fn default() -> Self {
        Self {
            max_width: 40,
            word_snap_distance: 15,
            ellipsis_prefix: "... ",
            ellipsis_suffix: " ...",
            min_context_when_range_is_large: 15,
        }
    }
}

impl TextWindow {
    /// Applies this windowing policy to owned text, preserving and remapping
    /// `range`.
    ///
    /// When no truncation is needed, the original allocation is reused.
    fn apply_owned(self, text: String, range: Range<usize>) -> WindowedText {
        if text.len() <= self.max_width {
            return WindowedText { text, range };
        }

        self.apply_sliced(&text, range)
    }

    /// Applies this windowing policy to borrowed text, always returning an
    /// owned window.
    #[allow(dead_code)]
    fn apply(self, text: &str, range: Range<usize>) -> WindowedText {
        if text.len() <= self.max_width {
            return WindowedText { text: text.to_owned(), range };
        }

        self.apply_sliced(text, range)
    }

    fn apply_sliced(self, text: &str, range: Range<usize>) -> WindowedText {
        let context_radius = self.context_radius(&range);
        let start = self.window_start(text, range.start, context_radius);
        let end = self.window_end(text, range.end, context_radius);

        let prefix_len = usize::from(start > 0) * self.ellipsis_prefix.len();
        let suffix_len = usize::from(end < text.len()) * self.ellipsis_suffix.len();
        let slice_len = end - start;

        let mut windowed = String::with_capacity(prefix_len + slice_len + suffix_len);
        let mut mapped = (range.start - start)..(range.end - start);

        if start > 0 {
            windowed.push_str(self.ellipsis_prefix);
            mapped.start += self.ellipsis_prefix.len();
            mapped.end += self.ellipsis_prefix.len();
        }

        windowed.push_str(&text[start..end]);

        if end < text.len() {
            windowed.push_str(self.ellipsis_suffix);
        }

        WindowedText { text: windowed, range: mapped }
    }

    /// Computes surrounding context for the highlighted range.
    fn context_radius(self, range: &Range<usize>) -> usize {
        let range_len = range.end.saturating_sub(range.start);
        if range_len < self.max_width {
            (self.max_width - range_len) / 2
        } else {
            self.min_context_when_range_is_large
        }
    }

    /// Computes the starting byte of the window.
    fn window_start(self, text: &str, highlight_start: usize, context_radius: usize) -> usize {
        let start = highlight_start.saturating_sub(context_radius);
        let start = self.floor_char_boundary(text, start);
        self.snap_start_to_word_boundary(text, start)
    }

    /// Computes the ending byte of the window.
    fn window_end(self, text: &str, highlight_end: usize, context_radius: usize) -> usize {
        let end = highlight_end.saturating_add(context_radius).min(text.len());
        let end = self.ceil_char_boundary(text, end);
        self.snap_end_to_word_boundary(text, end)
    }

    /// Moves `idx` down to the nearest valid UTF-8 char boundary.
    fn floor_char_boundary(self, text: &str, mut idx: usize) -> usize {
        while idx > 0 && !text.is_char_boundary(idx) {
            idx -= 1;
        }
        idx
    }

    /// Moves `idx` up to the nearest valid UTF-8 char boundary.
    fn ceil_char_boundary(self, text: &str, mut idx: usize) -> usize {
        while idx < text.len() && !text.is_char_boundary(idx) {
            idx += 1;
        }
        idx
    }

    /// Snaps `start` forward to just after a nearby preceding space.
    ///
    /// This avoids splitting a word at the start of the window when doing so is
    /// cheap enough.
    fn snap_start_to_word_boundary(self, text: &str, start: usize) -> usize {
        if start == 0 {
            return 0;
        }

        match text[..start].rfind(' ') {
            Some(space_idx) if start - space_idx <= self.word_snap_distance => space_idx + 1,
            _ => start,
        }
    }

    /// Snaps `end` backward to a nearby succeeding space.
    ///
    /// This avoids splitting a word at the end of the window when doing so is
    /// cheap enough.
    fn snap_end_to_word_boundary(self, text: &str, end: usize) -> usize {
        if end >= text.len() {
            return text.len();
        }

        match text[end..].find(' ') {
            Some(space_idx) if space_idx <= self.word_snap_distance => end + space_idx,
            _ => end,
        }
    }
}

/// Returns the byte range to highlight for a specific span part within one argument.
fn highlight_range(text: &str, part: SpanPart) -> Range<usize> {
    match part {
        SpanPart::Whole
        | SpanPart::Program
        | SpanPart::ArgRange { .. }
        | SpanPart::BareValue
        | SpanPart::Terminator
        | SpanPart::Environment
        | SpanPart::Default => 0..text.len(),

        SpanPart::LongName => {
            if let Some(rest) = text.strip_prefix("--") {
                let start = 2;
                let end = rest.find('=').map_or(text.len(), |idx| start + idx);
                start..end
            } else {
                0..text.len()
            }
        }

        SpanPart::ShortName => {
            if text.starts_with('-') && text.len() >= 2 {
                1..2
            } else {
                0..text.len()
            }
        }

        SpanPart::AttachedValue => {
            if let Some(eq) = text.find('=') {
                let start = eq + 1;
                start..text.len()
            } else if text.starts_with('-') && text.len() > 2 {
                2..text.len()
            } else {
                0..text.len()
            }
        }
    }
}

/// Destination stream for emitted diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stream {
    Stdout,
    Stderr,
}

impl SpanPart {
    /// Returns whether this span refers to a synthetic source rather than real argv.
    fn is_synthetic(self) -> bool {
        matches!(self, Self::Default | Self::Environment)
    }

    /// Returns the Ariadne source id appropriate for this span part.
    fn source_id(self) -> &'static str {
        match self {
            Self::Default => "schema://default",
            Self::Environment => "env://runtime",
            _ => "argv://runtime",
        }
    }

    /// Returns the source id for synthetic values.
    fn synthetic_source_id(self) -> &'static str {
        debug_assert!(self.is_synthetic());
        self.source_id()
    }

    /// Returns a placeholder string suitable for rendering this span part when no
    /// real source text is available.
    fn placeholder(self) -> &'static str {
        match self {
            Self::Program => "<command>",
            Self::Whole => "<arg>",
            Self::ArgRange { .. } => "<args>",
            Self::LongName => "<long-name>",
            Self::ShortName => "<short-name>",
            Self::AttachedValue => "<attached-value>",
            Self::BareValue => "<value>",
            Self::Terminator => "--",
            Self::Environment => "<environment variable>",
            Self::Default => "<default value>",
        }
    }
}

/// Error produced while emitting a runtime diagnostic.
#[derive(Debug, Error)]
pub enum RuntimeEmitError {
    /// Terminal or stream output failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}
