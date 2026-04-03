//! Command lookup extensions.
//!
//! These helpers centralize schema lookup plus parser-specific diagnostic
//! construction so parse-loop call sites remain small and focused.

use super::diagnostics::{render_arg, render_command, render_group, unknown_long_error};
use super::suggest::SuggestionProvider;
use crate::parse::error::{ParseError, ParseErrorKind, ParseFailure};
use crate::parse::model::Span;
use crate::schema::{ArgRef, CommandRef, LookupRef};

/// Parser-oriented schema lookup helpers for [`CommandRef`].
pub(super) trait CommandLookupExt<'a> {
    /// Resolve a long option name to an argument or return a diagnostic.
    fn resolve_long_arg<S: SuggestionProvider>(
        self,
        suggestions: &S,
        name: &str,
        span: Span,
    ) -> Result<ArgRef<'a>, ParseError>;

    /// Resolve a short option name to an argument or return a diagnostic.
    fn resolve_short_arg(self, name: char, span: Span) -> Result<ArgRef<'a>, ParseError>;
}

impl<'a> CommandLookupExt<'a> for CommandRef<'a> {
    fn resolve_long_arg<S: SuggestionProvider>(
        self,
        suggestions: &S,
        name: &str,
        span: Span,
    ) -> Result<ArgRef<'a>, ParseError> {
        match self.lookup_long(name) {
            Some(LookupRef::Arg(arg)) => Ok(arg),
            Some(LookupRef::Subcommand(_)) => {
                unreachable!("long lookup must never resolve to subcommand")
            }
            None => Err(unknown_long_error(suggestions, self, name, span)),
        }
    }

    fn resolve_short_arg(self, name: char, span: Span) -> Result<ArgRef<'a>, ParseError> {
        match self.lookup_short(name) {
            Some(LookupRef::Arg(arg)) => Ok(arg),
            Some(LookupRef::Subcommand(_)) => Err(ParseError::new(
                ParseErrorKind::UnknownShort,
                Some(span),
                format!(
                    "short option `-{name}` resolved unexpectedly \
                     to a subcommand"
                ),
            )),
            None => Err(ParseFailure::UnknownShort { name, span }
                .into_error(
                    |arg| render_arg(self, arg),
                    |command| render_command(self, command),
                    |group| render_group(self, group),
                )
                .with_help("try `--help` to see available options")),
        }
    }
}
