//! Rich runtime diagnostics rendered with Ariadne by default.

use std::io;
use std::ops::Range;
use std::path::Path;

use ariadne::{Color, Label, Report, ReportKind, Source};
use thiserror::Error;

use crate::decode::DecodeError;
use crate::parse::{ParseError, Span, SpanPart};
use crate::runtime_error::{ArgvSnapshot, RuntimeError};

/// Rich runtime diagnostic.
///
/// This is the presentation-oriented form of a [`RuntimeError`].
#[derive(Debug, Clone)]
pub struct RuntimeDiagnostic {
    error: RuntimeError,
    argv: Option<ArgvSnapshot>,
}

impl RuntimeDiagnostic {
    /// Create a runtime diagnostic from a runtime error.
    #[must_use]
    pub fn new(error: RuntimeError, argv: Option<ArgvSnapshot>) -> Self {
        Self { error, argv }
    }

    /// Return the underlying runtime error.
    #[must_use]
    pub fn error(&self) -> &RuntimeError {
        &self.error
    }

    /// Return the argv snapshot, if any.
    #[must_use]
    pub fn argv(&self) -> Option<&ArgvSnapshot> {
        self.argv.as_ref()
    }

    /// Print to stderr using Ariadne when span information is available,
    /// otherwise fall back to plain text.
    pub fn eprint(&self) -> Result<(), RuntimeEmitError> {
        self.emit(Stream::Stderr)
    }

    /// Print to stdout using Ariadne when span information is available,
    /// otherwise fall back to plain text.
    pub fn print(&self) -> Result<(), RuntimeEmitError> {
        self.emit(Stream::Stdout)
    }

    fn emit(&self, stream: Stream) -> Result<(), RuntimeEmitError> {
        match &self.error {
            RuntimeError::Parse(errors) => {
                for err in errors {
                    emit_parse_error(err, self.argv.as_ref(), stream)?;
                }
                Ok(())
            }
            RuntimeError::Decode(err) => emit_decode_error(err, self.argv.as_ref(), stream),
            RuntimeError::HelpRequested { .. } => emit_plain("help requested", stream),
        }
    }
}

fn emit_parse_error(
    err: &ParseError,
    argv: Option<&ArgvSnapshot>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    // If the error has no specific span (e.g. MissingRequired),
    let span = err.span().unwrap_or(Span { arg_index: 0, part: SpanPart::Program });

    let is_synthetic = matches!(span.part, SpanPart::Default | SpanPart::Environment);

    if let Some(argv) = argv.filter(|_| !is_synthetic) {
        emit_with_real_argv(
            err.to_string(),
            err.message(),
            err.notes(),
            err.help(),
            argv,
            span,
            stream,
        )
    } else {
        emit_with_synthetic_argv(
            err.to_string(),
            err.message(),
            err.notes(),
            err.help(),
            span,
            None,
            stream,
        )
    }
}

fn emit_decode_error(
    err: &DecodeError,
    argv: Option<&ArgvSnapshot>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    // If the error has no specific span, point to the very last argument provided!
    let span = err.span().unwrap_or(Span { arg_index: 0, part: SpanPart::Program });

    let is_synthetic = matches!(span.part, SpanPart::Default | SpanPart::Environment);

    if let Some(argv) = argv.filter(|_| !is_synthetic) {
        emit_with_real_argv(err.to_string(), err.message(), &[], None, argv, span, stream)
    } else {
        emit_with_synthetic_argv(
            err.to_string(),
            err.message(),
            &[],
            None,
            span,
            err.value(),
            stream,
        )
    }
}

fn emit_with_real_argv(
    title: String,
    label_message: &str,
    notes: &[Box<str>],
    help: Option<&str>,
    argv: &ArgvSnapshot,
    span: Span,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let rendered = render_real_argv_source(argv, span);
    let source_id = "argv://runtime";

    let mut report = Report::build(ReportKind::Error, (source_id, rendered.range.clone()))
        .with_message(title)
        .with_label(
            Label::new((source_id, rendered.range))
                .with_message(label_message.to_owned())
                .with_color(Color::Red),
        );

    for note in notes {
        report = report.with_note(note.as_ref());
    }

    if let Some(help) = help {
        report = report.with_help(help);
    }

    let report = report.finish();

    match stream {
        Stream::Stdout => report.print((source_id, Source::from(rendered.text)))?,
        Stream::Stderr => report.eprint((source_id, Source::from(rendered.text)))?,
    }

    Ok(())
}

fn emit_with_synthetic_argv(
    title: String,
    label_message: &str,
    notes: &[Box<str>],
    help: Option<&str>,
    span: Span,
    synthetic_value: Option<&str>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let rendered = render_synthetic_argv_source(span, synthetic_value);
    let source_id = match span.part {
        SpanPart::Default => "schema://default",
        SpanPart::Environment => "env://runtime",
        _ => "argv://runtime",
    };

    let mut report = Report::build(ReportKind::Error, (source_id, rendered.range.clone()))
        .with_message(title)
        .with_label(
            Label::new((source_id, rendered.range))
                .with_message(label_message.to_owned())
                .with_color(Color::Red),
        );

    for note in notes {
        report = report.with_note(note.as_ref());
    }

    if let Some(help) = help {
        report = report.with_help(help);
    }

    let report = report.finish();

    match stream {
        Stream::Stdout => report.print((source_id, Source::from(rendered.text)))?,
        Stream::Stderr => report.eprint((source_id, Source::from(rendered.text)))?,
    }

    Ok(())
}

fn emit_plain(text: &str, stream: Stream) -> Result<(), RuntimeEmitError> {
    match stream {
        Stream::Stdout => {
            use std::io::Write;
            let mut out = io::stdout().lock();
            writeln!(out, "{text}")?;
        }
        Stream::Stderr => {
            use std::io::Write;
            let mut out = io::stderr().lock();
            writeln!(out, "{text}")?;
        }
    }
    Ok(())
}

#[derive(Debug)]
struct RenderedArgvSource {
    text: String,
    range: Range<usize>,
}

fn render_real_argv_source(argv: &ArgvSnapshot, span: Span) -> RenderedArgvSource {
    let mut text = String::new();

    // 1. Reconstruct Program Context (Extracting ONLY the file name!)
    let prog_start = 0;
    if let Some(prog) = argv.program() {
        let path = Path::new(prog.as_os_str());
        let file_name = path.file_name().unwrap_or(prog.as_os_str()).to_string_lossy();
        text.push_str(&file_name);
    } else {
        text.push_str("<command>");
    }
    let prog_end = text.len();

    // 2. Reconstruct Arguments Context
    let mut arg_ranges = Vec::new();
    for arg in argv.args() {
        text.push(' ');
        let start = text.len();
        text.push_str(&arg.display().to_string());
        let end = text.len();
        arg_ranges.push(start..end);
    }

    // 3. Resolve the exact global byte range from the local offset!
    let range = if span.part == SpanPart::Program {
        prog_start..prog_end
    } else if let SpanPart::ArgRange { end_index } = span.part {
        let start = arg_ranges.get(span.arg_index as usize).map(|r| r.start).unwrap_or(0);
        let end = arg_ranges.get(end_index as usize).map(|r| r.end).unwrap_or(text.len());
        start..end
    } else if let Some(arg_range) = arg_ranges.get(span.arg_index as usize) {
        let arg_text = &text[arg_range.clone()];
        let local_range = highlight_range(arg_text, span.part);
        (arg_range.start + local_range.start)..(arg_range.start + local_range.end)
    } else {
        // Fallback if out of bounds or missing
        if text.is_empty() {
            text = "<missing-argv>".to_owned();
        }
        0..text.len()
    };

    // 4. Intelligently window the string so it never overflows the terminal context
    let (windowed_text, windowed_range) = window_text(&text, range);

    RenderedArgvSource { text: windowed_text, range: windowed_range }
}

/// A highly intelligent sliding-window truncator that preserves words and bounds constraints.
fn window_text(text: &str, range: Range<usize>) -> (String, Range<usize>) {
    const MAX_WIDTH: usize = 40;

    if text.len() <= MAX_WIDTH {
        return (text.to_owned(), range);
    }

    let range_len = range.end.saturating_sub(range.start);
    let ctx_radius = if range_len < MAX_WIDTH {
        (MAX_WIDTH - range_len) / 2
    } else {
        15 // Keep at least 15 chars of context if the error range itself is massive
    };

    let mut start_idx = range.start.saturating_sub(ctx_radius);
    while start_idx > 0 && !text.is_char_boundary(start_idx) {
        start_idx -= 1;
    }

    // Snap to nearest preceding space (max 15 chars back) to avoid splitting words
    if start_idx > 0
        && let Some(space_idx) = text[..start_idx].rfind(' ')
        && start_idx - space_idx <= 15
    {
        start_idx = space_idx + 1; // +1 to skip the space itself
    }

    let mut end_idx = range.end.saturating_add(ctx_radius);
    if end_idx > text.len() {
        end_idx = text.len();
    }
    while end_idx < text.len() && !text.is_char_boundary(end_idx) {
        end_idx += 1;
    }

    // Snap to nearest succeeding space (max 15 chars forward)
    if end_idx < text.len()
        && let Some(space_idx) = text[end_idx..].find(' ')
        && space_idx <= 15
    {
        end_idx += space_idx;
    }

    let mut windowed = String::new();
    let mut new_start = range.start - start_idx;
    let mut new_end = range.end - start_idx;

    if start_idx > 0 {
        windowed.push_str("... ");
        new_start += 4;
        new_end += 4;
    }

    windowed.push_str(&text[start_idx..end_idx]);

    if end_idx < text.len() {
        windowed.push_str(" ...");
    }

    (windowed, new_start..new_end)
}

fn render_synthetic_argv_source(span: Span, synthetic_value: Option<&str>) -> RenderedArgvSource {
    if let Some(val) = synthetic_value
        && matches!(span.part, SpanPart::Environment | SpanPart::Default)
    {
        return RenderedArgvSource { text: val.to_string(), range: 0..val.len() };
    }

    let part = match span.part {
        SpanPart::Program => "<command>",
        SpanPart::Whole => "<arg>",
        SpanPart::ArgRange { .. } => "<args>",
        SpanPart::LongName => "<long-name>",
        SpanPart::ShortName => "<short-name>",
        SpanPart::AttachedValue => "<attached-value>",
        SpanPart::BareValue => "<value>",
        SpanPart::Terminator => "--",
        SpanPart::Environment => "<environment variable>",
        SpanPart::Default => "<default value>",
    };

    if matches!(
        span.part,
        SpanPart::Environment | SpanPart::Default | SpanPart::Program | SpanPart::ArgRange { .. }
    ) {
        return RenderedArgvSource { text: part.to_string(), range: 0..part.len() };
    }

    let prefix = format!("argv[{}] ", span.arg_index);
    let start = prefix.len();
    let text = format!("{prefix}{part}");
    let end = text.len();

    RenderedArgvSource { text, range: start..end }
}

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
                let end = rest.find('=').map(|idx| start + idx).unwrap_or(text.len());
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stream {
    Stdout,
    Stderr,
}

/// Error produced while emitting a runtime diagnostic.
#[derive(Debug, Error)]
pub enum RuntimeEmitError {
    /// Terminal or stream output failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}
