//! Diagnostic construction and rendering.
//!
//! These helpers are intentionally off the parser hot path. The goal here is
//! clear, deterministic, user-friendly diagnostics rather than aggressive
//! micro-optimization.

use super::suggest::SuggestionProvider;
use crate::parse::error::{ParseError, ParseErrorKind, ParseFailure};
use crate::parse::model::{RawValue, Span};
use crate::schema::CommandRef;

/// Build an unknown-long-option diagnostic, including spelling suggestions.
pub(super) fn unknown_long_error<S: SuggestionProvider>(
    suggestions: &S,
    command: CommandRef<'_>,
    name: &str,
    span: Span,
) -> ParseError {
    let candidates = suggestions.suggest_longs(command, name);

    let mut err = ParseFailure::UnknownLong { name: name.into(), span }
        .into_error(
            |arg| render_arg(command, arg),
            |cmd| render_command(command, cmd),
            |group| render_group(command, group),
        )
        .with_help("try `--help` to see available options");

    if !candidates.is_empty() {
        err = err.with_note(format!("did you mean {}?", format_suggestions(&candidates)));
    }

    err
}

/// Build a diagnostic for an unexpected value token.
pub(super) fn unexpected_value_error<S: SuggestionProvider>(
    suggestions: &S,
    cmd: CommandRef<'_>,
    raw: &RawValue,
    span: Span,
) -> ParseError {
    let text = raw.display().to_string();

    let mut err = ParseFailure::UnexpectedValue { value: text.into_boxed_str(), span }
        .into_error(
            |arg| render_arg(cmd, arg),
            |command| render_command(cmd, command),
            |group| render_group(cmd, group),
        )
        .with_help("try `--help` to see supported arguments");

    if let Ok(candidate) = raw.try_as_str()
        && looks_like_subcommand_candidate(candidate)
    {
        let candidates = suggestions.suggest_subcommands(cmd, candidate);
        if !candidates.is_empty() {
            err = err.with_note(format!("did you mean {}?", format_suggestions(&candidates)));
        }
    }

    err
}

/// Add contextual help to validation failures that benefit from it.
pub(super) fn enrich_validation_error(cmd: CommandRef<'_>, failure: ParseFailure) -> ParseError {
    let mut err = failure.into_error(
        |arg| render_arg(cmd, arg),
        |command| render_command(cmd, command),
        |group| render_group(cmd, group),
    );

    match err.kind() {
        ParseErrorKind::MissingRequired
        | ParseErrorKind::Conflict
        | ParseErrorKind::Requires
        | ParseErrorKind::MissingValue => {
            err = err.with_help("try `--help` to see supported arguments");
        }
        _ => {}
    }

    err
}

/// Render an argument for diagnostics.
pub(super) fn render_arg(command: CommandRef<'_>, arg: crate::ids::ArgId) -> String {
    let arg = crate::schema::ArgRef { schema: command.schema, id: arg };

    if let Some(long) = arg.long() {
        format!("--{long}")
    } else if let Some(short) = arg.short() {
        format!("-{short}")
    } else {
        arg.id_string().to_owned()
    }
}

/// Render a command for diagnostics.
pub(super) fn render_command(command: CommandRef<'_>, id: crate::ids::CommandId) -> String {
    let cmd = crate::schema::CommandRef { schema: command.schema, id };

    cmd.name().to_owned()
}

/// Render a group for diagnostics.
pub(super) fn render_group(command: CommandRef<'_>, id: crate::ids::GroupId) -> String {
    let group = crate::schema::GroupRef { schema: command.schema, id };

    group.id_string().to_owned()
}

/// Render a short human-readable list of suggestions.
fn format_suggestions(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => format!("`{one}`"),
        [a, b] => format!("`{a}` or `{b}`"),
        [a, b, c, ..] => format!("`{a}`, `{b}`, or `{c}`"),
    }
}

/// Return whether a value looks plausible as a mistyped subcommand.
fn looks_like_subcommand_candidate(text: &str) -> bool {
    !text.starts_with('-')
}
