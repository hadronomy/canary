//! Core schema-driven CLI parser.
//!
//! This parser consumes tokenized argv, normalizes option-like input against
//! the active command schema, and builds a raw command-match tree.
//!
//! The implementation is deliberately iterative and non-recursive on the hot
//! path. Errors are accumulated and deferred so that `--help` can reliably
//! bypass otherwise fatal parse and validation failures.
//!
//! Publicly, this module exposes only [`parse_command`]. Internally, the work
//! is split into smaller private modules:
//!
//! - normalization of raw lexical tokens
//! - positional dispatch
//! - fallback injection
//! - diagnostics and suggestions
//! - small typed helpers for value occurrences

mod diagnostics;
mod env;
mod fallback;
mod lookup;
mod normalization;
mod occurrence;
mod positionals;
mod suggest;

use std::collections::VecDeque;

use self::diagnostics::{enrich_validation_error, unexpected_value_error};
use self::env::{EnvProvider, StdEnv};
use self::lookup::CommandLookupExt;
use self::occurrence::{MatchedValue, bind_value};
use self::positionals::Positionals;
use self::suggest::{LevenshteinSuggester, SuggestionProvider};
use crate::builder::ArgActionKind;
use crate::parse::error::{ParseError, ParseFailure};
use crate::parse::model::{
    ArgMatch, CommandMatch, NormalizedToken, ParseOutput, Span, SpanPart, ValueId,
};
use crate::parse::state::CommandState;
use crate::parse::token::{RawToken, TokenizedArgv};
use crate::parse::validate::validate_command;
use crate::schema::{ArgRef, Command, CommandRef, LookupRef};

/// Parse tokenized argv against a compiled command schema.
///
/// On success, this returns the matched command tree and the frozen value store
/// containing both original source values and any values synthesized during
/// parsing, such as environment and default fallbacks.
///
/// On failure, this returns all accumulated parse and validation errors so the
/// caller can render rich diagnostics.
pub fn parse_command(
    command: &Command,
    input: TokenizedArgv,
) -> Result<ParseOutput, Vec<ParseError>> {
    let (program, source_values, raw_tokens) = input.into_parts();
    let mut values_builder = crate::parse::model::ValueStoreBuilder::from_store(&source_values);

    let parser =
        Parser::new(&raw_tokens, &mut values_builder, StdEnv, LevenshteinSuggester::default());
    let root_match = parser.parse(command.as_ref())?;

    Ok(ParseOutput { program, root: root_match, values: values_builder.freeze() })
}

/// Stateful parser over one tokenized argv stream.
///
/// The parser owns the mutable context required to:
///
/// - consume raw lexical tokens,
/// - normalize option-like input according to the active command schema,
/// - inject environment and default fallbacks,
/// - accumulate parse and validation errors,
/// - and build the final raw match tree.
///
/// The parser is generic over:
///
/// - `E`: the environment provider used for fallback lookup
/// - `S`: the suggestion strategy used for diagnostics
///
/// Both are private implementation details, so the public API remains small.
struct Parser<'a, E, S> {
    /// Raw lexical tokens produced from argv.
    raw_tokens: &'a [RawToken],
    /// Current index into `raw_tokens`.
    cursor: usize,
    /// Normalized tokens ready for the parse loop.
    normalized_buffer: VecDeque<NormalizedToken>,
    /// Mutable value-store builder used to append synthesized values.
    values: &'a mut crate::parse::model::ValueStoreBuilder,
    /// Environment source used for fallback lookup.
    env: E,
    /// Suggestion strategy used for friendly diagnostics.
    suggestions: S,
    /// Flattened list of commands built during parsing.
    commands: Vec<(crate::ids::CommandId, Box<[ArgMatch]>)>,
    /// Accumulated parse and validation errors.
    errors: Vec<ParseError>,
    /// Whether `--help` has been encountered anywhere in the active parse.
    help_triggered: bool,
    /// Whether the `--` terminator has already been seen.
    after_terminator: bool,
}

impl<'a, E, S> Parser<'a, E, S>
where
    E: EnvProvider,
    S: SuggestionProvider,
{
    /// Create a new parser over a token stream and mutable value store.
    fn new(
        raw_tokens: &'a [RawToken],
        values: &'a mut crate::parse::model::ValueStoreBuilder,
        env: E,
        suggestions: S,
    ) -> Self {
        Self {
            raw_tokens,
            cursor: 0,
            normalized_buffer: VecDeque::new(),
            values,
            env,
            suggestions,
            commands: Vec::new(),
            errors: Vec::new(),
            help_triggered: false,
            after_terminator: false,
        }
    }

    /// Execute the non-recursive parse loop starting at the root command.
    fn parse(mut self, root_cmd: CommandRef<'a>) -> Result<CommandMatch, Vec<ParseError>> {
        let mut current_cmd = root_cmd;
        let mut current_cmd_span = Some(Span { arg_index: 0, part: SpanPart::Program });

        loop {
            let mut state = CommandState::new(current_cmd);
            let mut next_cmd = None;
            let mut positionals = Positionals::new(current_cmd);

            while let Some(token) = self.next_token(current_cmd) {
                match token {
                    NormalizedToken::Terminator { .. } => {}
                    NormalizedToken::Long { name, span } => {
                        self.handle_long(current_cmd, &mut state, &name, span);
                    }
                    NormalizedToken::Short { name, span } => {
                        self.handle_short(current_cmd, &mut state, name, span);
                    }
                    NormalizedToken::Value { value, span } => {
                        if let Some(sub) = self.handle_value(
                            current_cmd,
                            &mut state,
                            &mut positionals,
                            value,
                            span,
                        ) {
                            next_cmd = Some((sub, span));
                            break;
                        }
                    }
                }

                if self.help_triggered {
                    break;
                }
            }

            if !self.help_triggered {
                self.apply_fallbacks(current_cmd, &mut state);
                self.validate_current_command(current_cmd, &state, current_cmd_span);
            }

            self.commands.push((current_cmd.id(), state.freeze(current_cmd)));

            match next_cmd {
                Some((sub, span)) if !self.help_triggered => {
                    current_cmd = sub;
                    current_cmd_span = Some(span);
                }
                _ => break,
            }
        }

        if !self.help_triggered && !self.errors.is_empty() {
            return Err(self.errors);
        }

        let root_match = self.commands.into_iter().rfold(None, |subcommand, (command, args)| {
            Some(Box::new(CommandMatch { command, args, subcommand }))
        });

        Ok(*root_match.expect("parser must produce at least one command match"))
    }

    /// Validate the command currently being built.
    fn validate_current_command(
        &mut self,
        cmd: CommandRef<'a>,
        state: &CommandState,
        command_span: Option<Span>,
    ) {
        if let Err(failure) = validate_command(cmd, state, self.values, command_span) {
            self.errors.push(enrich_validation_error(cmd, failure));
        }
    }

    /// Handle a normalized long-option token.
    fn handle_long(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        name: &str,
        span: Span,
    ) {
        match cmd.resolve_long_arg(&self.suggestions, name, span) {
            Ok(arg) => self.apply_arg(cmd, state, arg, span),
            Err(error) => self.errors.push(error),
        }
    }

    /// Handle a normalized short-option token.
    fn handle_short(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        name: char,
        span: Span,
    ) {
        match cmd.resolve_short_arg(name, span) {
            Ok(arg) => self.apply_arg(cmd, state, arg, span),
            Err(error) => self.errors.push(error),
        }
    }

    /// Handle a normalized value token.
    ///
    /// Values may either:
    ///
    /// - select a subcommand, or
    /// - bind to the next available positional argument.
    fn handle_value(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        positionals: &mut Positionals,
        value: ValueId,
        span: Span,
    ) -> Option<CommandRef<'a>> {
        let raw = self.values.get(value);

        if let Ok(text) = raw.try_as_str()
            && let Some(LookupRef::Subcommand(sub)) = cmd.lookup_subcommand(text)
        {
            return Some(sub);
        }

        if let Some(local) = positionals.next_local() {
            state.mark_seen(local);
            bind_value(state, local, span, MatchedValue::positional(value, span));
            positionals.record_value(local);
        } else {
            self.errors.push(unexpected_value_error(&self.suggestions, cmd, raw, span));
        }

        None
    }

    /// Apply one matched argument occurrence.
    fn apply_arg(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        arg: ArgRef<'a>,
        span: Span,
    ) {
        if arg.action() == ArgActionKind::Help {
            let local = cmd.local_arg_by_id(arg.id()).expect("effective arg must have local slot");

            state.mark_seen(local);
            state.match_builder(local).push_flag(span);
            self.help_triggered = true;
            return;
        }

        if let Err(error) = self.parse_arg_occurrence(arg, cmd, state, span) {
            self.errors.push(error);
        }
    }

    /// Parse a single argument occurrence, consuming its value when required.
    fn parse_arg_occurrence(
        &mut self,
        arg: ArgRef<'a>,
        command: CommandRef<'a>,
        state: &mut CommandState,
        span: Span,
    ) -> Result<(), ParseError> {
        let local = command.local_arg_by_id(arg.id()).expect("effective arg must have local slot");

        state.mark_seen(local);

        if !arg.takes_value() {
            state.match_builder(local).push_flag(span);
            return Ok(());
        }

        if let Some((value, value_span)) = self.next_value_token(command) {
            bind_value(state, local, span, MatchedValue::option(value, span, value_span));
            return Ok(());
        }

        Err(ParseFailure::MissingValue { arg: arg.id(), span }
            .into_error(
                |arg| diagnostics::render_arg(command, arg),
                |cmd| diagnostics::render_command(command, cmd),
                |group| diagnostics::render_group(command, group),
            )
            .with_help("pass a value after this option or use `--help`"))
    }
}

/// Create a synthetic span for values not sourced directly from argv.
pub(super) fn synthetic_span(part: SpanPart) -> Span {
    Span { arg_index: 0, part }
}

/// Reuse an argv index while replacing only the semantic span part.
pub(super) fn span_with_part(span: Span, part: SpanPart) -> Span {
    Span { arg_index: span.arg_index, part }
}
