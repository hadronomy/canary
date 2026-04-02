//! Rich runtime diagnostics rendered with Ariadne by default.

use std::io;
use std::ops::Range;

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
    if let Some(span) = err.span() {
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
    } else {
        emit_plain_with_extras(&err.to_string(), err.notes(), err.help(), stream)
    }
}

fn emit_decode_error(
    err: &DecodeError,
    argv: Option<&ArgvSnapshot>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    if let Some(span) = err.span() {
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
    } else {
        emit_plain_with_extras(&err.to_string(), &[], None, stream)
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

fn emit_plain_with_extras(
    text: &str,
    notes: &[Box<str>],
    help: Option<&str>,
    stream: Stream,
) -> Result<(), RuntimeEmitError> {
    let mut out = text.to_owned();

    for note in notes {
        out.push_str("\nnote: ");
        out.push_str(note);
    }

    if let Some(help) = help {
        out.push_str("\nhelp: ");
        out.push_str(help);
    }

    emit_plain(&out, stream)
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
    let raw = argv
        .get(span.arg_index)
        .map(|value| value.display().to_string())
        .unwrap_or_else(|| "<missing-argv>".to_owned());

    let highlight = highlight_range(&raw, span.part);

    RenderedArgvSource { text: raw, range: highlight }
}

fn render_synthetic_argv_source(span: Span, synthetic_value: Option<&str>) -> RenderedArgvSource {
    if let Some(val) = synthetic_value
        && matches!(span.part, SpanPart::Environment | SpanPart::Default)
    {
        return RenderedArgvSource { text: val.to_string(), range: 0..val.len() };
    }

    let part = match span.part {
        SpanPart::Whole => "<arg>",
        SpanPart::LongName => "<long-name>",
        SpanPart::ShortName => "<short-name>",
        SpanPart::AttachedValue => "<attached-value>",
        SpanPart::BareValue => "<value>",
        SpanPart::Terminator => "--",
        SpanPart::Environment => "<environment variable>",
        SpanPart::Default => "<default value>",
    };

    if matches!(span.part, SpanPart::Environment | SpanPart::Default) {
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
        // These parts represent entire discrete tokens or synthetic injections,
        // so we beautifully highlight the entire text length.
        SpanPart::Whole
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
