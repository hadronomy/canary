//! Core schema-driven CLI parser.
//!
//! This parser consumes raw tokenized argv and normalizes tokens on the fly
//! against the active command schema. It produces raw matched command/arg
//! occurrences using an iterative, non-recursive state loop for maximum
//! performance and defers errors so that `--help` can reliably bypass them.

use std::collections::VecDeque;

use crate::builder::{ArgActionKind, ArgKind};
use crate::ids::LocalArgIndex;
use crate::parse::error::{ParseError, ParseErrorKind, ParseFailure};
use crate::parse::model::{
    CommandMatch, NormalizedToken, ParseOutput, RawValue, Span, SpanPart, ValueId, ValueOccurrence,
    ValueOrigin,
};
use crate::parse::state::CommandState;
use crate::parse::token::{RawToken, TokenizedArgv};
use crate::parse::validate::validate_command;
use crate::schema::{ArgRef, Command, CommandRef, DefaultValueRef, LookupRef};

/// Parse tokenized argv against a compiled command schema.
///
/// If validation fails, this returns a vector of `ParseError`s, allowing
/// the caller to render rich, multi-label diagnostics.
pub fn parse_command(
    command: &Command,
    input: TokenizedArgv,
) -> Result<ParseOutput, Vec<ParseError>> {
    let (program, source_values, raw_tokens) = input.into_parts();
    let mut values_builder = crate::parse::model::ValueStoreBuilder::from_store(&source_values);

    let parser = Parser::new(&raw_tokens, &mut values_builder);
    let root_match = parser.parse(command.as_ref())?;

    Ok(ParseOutput { program, root: root_match, values: values_builder.freeze() })
}

/// Encapsulated parser state for the token stream.
///
/// This struct holds the mutable context required to process tokens iteratively,
/// normalize raw tokens against the active command schema, dynamically inject
/// environment variables and defaults, and accumulate all syntax and validation
/// errors for beautiful multi-label diagnostics.
struct Parser<'a> {
    /// The raw lexical tokens produced from argv.
    raw_tokens: &'a [RawToken],
    /// Current index into `raw_tokens`.
    cursor: usize,
    /// A buffer of normalized tokens ready for parsing.
    normalized_buffer: VecDeque<NormalizedToken>,
    /// A mutable builder enabling us to dynamically inject environment and
    /// default values.
    values: &'a mut crate::parse::model::ValueStoreBuilder,
    /// Flattened list of constructed commands.
    commands: Vec<(crate::ids::CommandId, Box<[crate::parse::model::ArgMatch]>)>,
    /// Accumulated parse and validation errors.
    errors: Vec<ParseError>,
    /// Short-circuit flag when `--help` is encountered anywhere in the input.
    help_triggered: bool,
    /// Tracks whether the `--` terminator has been encountered.
    after_terminator: bool,
}

impl<'a> Parser<'a> {
    /// Initialize a new parser from the token stream.
    fn new(
        raw_tokens: &'a [RawToken],
        values: &'a mut crate::parse::model::ValueStoreBuilder,
    ) -> Self {
        Self {
            raw_tokens,
            cursor: 0,
            normalized_buffer: VecDeque::new(),
            values,
            commands: Vec::new(),
            errors: Vec::new(),
            help_triggered: false,
            after_terminator: false,
        }
    }

    /// Consume the next normalized token using the current subcommand's schema.
    fn next_token(&mut self, current_cmd: CommandRef<'a>) -> Option<NormalizedToken> {
        self.fill_buffer(current_cmd);
        self.normalized_buffer.pop_front()
    }

    /// Consume the next normalized token only if it is a value.
    ///
    /// This is a hot-path helper used while parsing options that expect a value.
    /// It avoids cloning the front token just to discover whether it is a value.
    fn next_value_token(&mut self, current_cmd: CommandRef<'a>) -> Option<(ValueId, Span)> {
        self.fill_buffer(current_cmd);

        match self.normalized_buffer.front() {
            Some(NormalizedToken::Value { value, span }) => {
                let value = *value;
                let span = *span;
                self.normalized_buffer.pop_front();
                Some((value, span))
            }
            _ => None,
        }
    }

    /// Read raw tokens and normalize them until the buffer has at least one
    /// token, or we run out of input.
    fn fill_buffer(&mut self, current_cmd: CommandRef<'a>) {
        while self.normalized_buffer.is_empty() && self.cursor < self.raw_tokens.len() {
            let token = self.raw_tokens[self.cursor];
            self.cursor += 1;

            match token {
                RawToken::Terminator { span } => {
                    self.after_terminator = true;
                    self.normalized_buffer.push_back(NormalizedToken::Terminator { span });
                }
                RawToken::Value { value, span } => {
                    self.normalized_buffer.push_back(NormalizedToken::Value { value, span });
                }
                RawToken::OptionLike { value, span } => {
                    if self.after_terminator {
                        self.normalized_buffer.push_back(NormalizedToken::Value {
                            value,
                            span: Span { arg_index: span.arg_index, part: SpanPart::BareValue },
                        });
                    } else if let Err(error) = self.normalize_option_like(current_cmd, value, span)
                    {
                        self.errors.push(error);
                    }
                }
            }
        }
    }

    /// Schema-aware normalization for an option-like string
    /// (e.g., `-v`, `--config=file`).
    ///
    /// To avoid borrow conflicts with `self.values` while still keeping
    /// allocations modest, this first extracts only the needed suffix of the
    /// token into a compact owned buffer and then performs normalization.
    fn normalize_option_like(
        &mut self,
        cmd: CommandRef<'a>,
        value_id: ValueId,
        span: Span,
    ) -> Result<(), ParseError> {
        enum OptionLikeTail {
            Long(Box<str>),
            Short(Box<str>),
            Bare,
        }

        let tail = {
            let raw = self.values.get(value_id);
            let text = raw.try_as_str().map_err(|err| {
                ParseError::new(
                    ParseErrorKind::NonUtf8OptionLike,
                    Some(span),
                    format!("option-like argv entry must be valid UTF-8: {err}"),
                )
            })?;

            if let Some(rest) = text.strip_prefix("--") {
                OptionLikeTail::Long(rest.into())
            } else if let Some(rest) = text.strip_prefix('-') {
                OptionLikeTail::Short(rest.into())
            } else {
                OptionLikeTail::Bare
            }
        };

        match tail {
            OptionLikeTail::Long(rest) => self.normalize_long(span, &rest),
            OptionLikeTail::Short(rest) => self.normalize_short_cluster(cmd, span, &rest),
            OptionLikeTail::Bare => {
                self.normalized_buffer.push_back(NormalizedToken::Value {
                    value: value_id,
                    span: Span { arg_index: span.arg_index, part: SpanPart::BareValue },
                });
                Ok(())
            }
        }
    }

    /// Normalize a long option (e.g., `verbose` or `config=file`).
    fn normalize_long(&mut self, span: Span, rest: &str) -> Result<(), ParseError> {
        if rest.is_empty() {
            return Err(ParseError::new(
                ParseErrorKind::InvalidLongSyntax,
                Some(span),
                "long option name must not be empty",
            ));
        }

        match rest.split_once('=') {
            Some((name, attached)) => {
                if name.is_empty() {
                    return Err(ParseError::new(
                        ParseErrorKind::InvalidLongSyntax,
                        Some(span),
                        "long option name must not be empty",
                    ));
                }

                self.normalized_buffer.push_back(NormalizedToken::Long {
                    name: name.into(),
                    span: Span { arg_index: span.arg_index, part: SpanPart::LongName },
                });

                let value = self.values.push(RawValue::from(attached));
                self.normalized_buffer.push_back(NormalizedToken::Value {
                    value,
                    span: Span { arg_index: span.arg_index, part: SpanPart::AttachedValue },
                });

                Ok(())
            }
            None => {
                self.normalized_buffer.push_back(NormalizedToken::Long {
                    name: rest.into(),
                    span: Span { arg_index: span.arg_index, part: SpanPart::LongName },
                });
                Ok(())
            }
        }
    }

    /// Normalize a cluster of short options (e.g., `-vab` or `-ofile.txt`).
    fn normalize_short_cluster(
        &mut self,
        cmd: CommandRef<'a>,
        span: Span,
        rest: &str,
    ) -> Result<(), ParseError> {
        if rest.is_empty() {
            return Err(ParseError::new(
                ParseErrorKind::UnknownShort,
                Some(span),
                "short option cluster must not be empty",
            ));
        }

        for (byte_offset, short) in rest.char_indices() {
            let arg = match cmd.lookup_short(short) {
                Some(LookupRef::Arg(arg)) => arg,
                Some(LookupRef::Subcommand(_)) => {
                    return Err(ParseError::new(
                        ParseErrorKind::UnknownShort,
                        Some(span),
                        format!(
                            "short option `-{short}` resolved unexpectedly \
                             to a subcommand"
                        ),
                    ));
                }
                None => {
                    return Err(ParseError::new(
                        ParseErrorKind::UnknownShort,
                        Some(span),
                        format!("unknown short option `-{short}`"),
                    )
                    .with_help("try `--help` to see available options"));
                }
            };

            self.normalized_buffer.push_back(NormalizedToken::Short {
                name: short,
                span: Span { arg_index: span.arg_index, part: SpanPart::ShortName },
            });

            if arg.takes_value() {
                let value_start = byte_offset + short.len_utf8();
                if value_start < rest.len() {
                    let attached = &rest[value_start..];
                    let value = self.values.push(RawValue::from(attached));

                    self.normalized_buffer.push_back(NormalizedToken::Value {
                        value,
                        span: Span { arg_index: span.arg_index, part: SpanPart::AttachedValue },
                    });

                    // The rest of the cluster is consumed as the attached value.
                    break;
                }
            }
        }

        Ok(())
    }

    /// Execute the non-recursive parsing loop.
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

    fn apply_fallbacks(&mut self, cmd: CommandRef<'a>, state: &mut CommandState) {
        for (local, arg, _) in cmd.local_args() {
            if state.is_seen(local) {
                continue;
            }

            if self.apply_env_fallback(arg, local, state) {
                continue;
            }

            self.apply_default_fallback(arg, local, state);
        }
    }

    fn apply_env_fallback(
        &mut self,
        arg: ArgRef<'a>,
        local: LocalArgIndex,
        state: &mut CommandState,
    ) -> bool {
        let Some(env_name) = arg.env() else {
            return false;
        };

        let Some(value) = std::env::var_os(env_name) else {
            return false;
        };

        let env_span = synthetic_span(SpanPart::Environment);

        if !arg.takes_value() {
            let text = value.to_string_lossy();

            if text.is_empty() || text == "0" || text.eq_ignore_ascii_case("false") {
                return false;
            }

            if arg.action() == ArgActionKind::Count
                && let Ok(count) = text.parse::<usize>()
            {
                state.mark_seen(local);
                for _ in 0..count {
                    state.match_builder(local).push_flag(env_span);
                }
                return true;
            }
        }

        state.mark_seen(local);

        if arg.takes_value() {
            let value_id = self.values.push(RawValue::from(value));
            state.match_builder(local).push_value(
                env_span,
                ValueOccurrence {
                    value: value_id,
                    span: env_span,
                    origin: ValueOrigin::Environment,
                },
            );
        } else {
            state.match_builder(local).push_flag(env_span);
        }

        true
    }

    fn apply_default_fallback(
        &mut self,
        arg: ArgRef<'a>,
        local: LocalArgIndex,
        state: &mut CommandState,
    ) {
        let Some(spec) = arg.value_spec() else {
            return;
        };

        let Some(DefaultValueRef::String(default)) = spec.default() else {
            return;
        };

        let default_span = synthetic_span(SpanPart::Default);
        let value_id = self.values.push(RawValue::from(default));

        state.mark_seen(local);
        state.match_builder(local).push_value(
            default_span,
            ValueOccurrence { value: value_id, span: default_span, origin: ValueOrigin::Default },
        );
    }

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

    fn handle_long(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        name: &str,
        span: Span,
    ) {
        match cmd.lookup_long(name) {
            Some(LookupRef::Arg(arg)) => self.apply_arg(cmd, state, arg, span),
            Some(LookupRef::Subcommand(_)) => {
                unreachable!("long lookup must never resolve to subcommand")
            }
            None => {
                self.errors.push(unknown_long_error(cmd, name, span));
            }
        }
    }

    fn handle_short(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        name: char,
        span: Span,
    ) {
        match cmd.lookup_short(name) {
            Some(LookupRef::Arg(arg)) => self.apply_arg(cmd, state, arg, span),
            Some(LookupRef::Subcommand(_)) => {
                unreachable!("short lookup must never resolve to subcommand")
            }
            None => {
                self.errors.push(ParseFailure::UnknownShort { name, span }.into_error(
                    |arg| render_arg(cmd, arg),
                    |command| render_command(cmd, command),
                    |group| render_group(cmd, group),
                ));
            }
        }
    }

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
            state
                .match_builder(local)
                .push_value(span, ValueOccurrence { value, span, origin: ValueOrigin::Positional });
            positionals.record_value(local);
        } else {
            self.errors.push(unexpected_value_error(cmd, raw, span));
        }

        None
    }

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
            let origin = match value_span.part {
                SpanPart::AttachedValue if matches!(span.part, SpanPart::LongName) => {
                    ValueOrigin::AttachedLong
                }
                SpanPart::AttachedValue => ValueOrigin::AttachedShort,
                _ => ValueOrigin::Separate,
            };

            state
                .match_builder(local)
                .push_value(span, ValueOccurrence { value, span: value_span, origin });

            return Ok(());
        }

        Err(ParseFailure::MissingValue { arg: arg.id(), span }
            .into_error(
                |arg| render_arg(command, arg),
                |cmd| render_command(command, cmd),
                |group| render_group(command, group),
            )
            .with_help("pass a value after this option or use `--help`"))
    }
}

#[derive(Clone, Copy)]
enum PositionalCapacity {
    /// Accept exactly one value in practice.
    ///
    /// This mirrors the previous behavior for positional args without a value
    /// spec and for specs whose effective max becomes one after the first bind.
    Single,
    /// Accept up to `max` values total.
    Bounded(usize),
    /// Accept arbitrarily many values.
    Unbounded,
}

impl PositionalCapacity {
    fn allows_following_values(self, seen_values: usize) -> bool {
        match self {
            Self::Single => false,
            Self::Bounded(max) => seen_values < max,
            Self::Unbounded => true,
        }
    }
}

struct PositionalEntry {
    local: LocalArgIndex,
    capacity: PositionalCapacity,
    seen_values: usize,
}

/// Lightweight hot-path cache for positional argument dispatch.
///
/// The original implementation scanned all local args and recomputed value
/// counts from match state for every bare value token. That is correct, but it
/// does repeated work on the hottest positional path.
///
/// This cache preserves the same observable behavior while exploiting a key
/// parser property: during a command parse, positional consumption is monotonic.
/// Once a positional is full, it will never become available again.
struct Positionals {
    entries: Vec<PositionalEntry>,
    cursor: usize,
}

impl Positionals {
    fn new(command: CommandRef<'_>) -> Self {
        let entries = command
            .local_args()
            .filter(|&(_local, arg, _)| arg.kind() == ArgKind::Positional)
            .map(|(local, arg, _)| PositionalEntry {
                local,
                capacity: positional_capacity(arg),
                seen_values: 0,
            })
            .collect();

        Self { entries, cursor: 0 }
    }

    fn next_local(&mut self) -> Option<LocalArgIndex> {
        while let Some(entry) = self.entries.get(self.cursor) {
            if entry.seen_values == 0 || entry.capacity.allows_following_values(entry.seen_values) {
                return Some(entry.local);
            }

            self.cursor += 1;
        }

        None
    }

    fn record_value(&mut self, local: LocalArgIndex) {
        let Some(entry) = self.entries.get_mut(self.cursor) else {
            return;
        };

        debug_assert_eq!(entry.local, local);
        entry.seen_values += 1;

        if !entry.capacity.allows_following_values(entry.seen_values) {
            self.cursor += 1;
        }
    }
}

fn positional_capacity(arg: ArgRef<'_>) -> PositionalCapacity {
    match arg.value_spec() {
        None => PositionalCapacity::Single,
        Some(spec) => match spec.arity().max() {
            None => PositionalCapacity::Unbounded,
            Some(1) => PositionalCapacity::Single,
            Some(max) => PositionalCapacity::Bounded(max as usize),
        },
    }
}

fn synthetic_span(part: SpanPart) -> Span {
    Span { arg_index: 0, part }
}

fn unknown_long_error(command: CommandRef<'_>, name: &str, span: Span) -> ParseError {
    let suggestions = suggest_long(command, name);

    let mut err = ParseFailure::UnknownLong { name: name.into(), span }
        .into_error(
            |arg| render_arg(command, arg),
            |cmd| render_command(command, cmd),
            |group| render_group(command, group),
        )
        .with_help("try `--help` to see available options");

    if !suggestions.is_empty() {
        err = err.with_note(format!("did you mean {}?", format_suggestions(&suggestions)));
    }

    err
}

fn unexpected_value_error(cmd: CommandRef<'_>, raw: &RawValue, span: Span) -> ParseError {
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
        let suggestions = suggest_subcommand(cmd, candidate);
        if !suggestions.is_empty() {
            err = err.with_note(format!("did you mean {}?", format_suggestions(&suggestions)));
        }
    }

    err
}

fn enrich_validation_error(cmd: CommandRef<'_>, failure: ParseFailure) -> ParseError {
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

fn suggest_long(command: CommandRef<'_>, input: &str) -> Vec<String> {
    let mut candidates = command
        .args()
        .flat_map(|arg| {
            arg.long()
                .into_iter()
                .map(ToOwned::to_owned)
                .chain(arg.aliases().map(|alias| alias.name().to_owned()))
        })
        .collect::<Vec<_>>();

    candidates.sort_unstable();
    candidates.dedup();

    nearest_candidates(input, candidates, 3)
}

fn suggest_subcommand(command: CommandRef<'_>, input: &str) -> Vec<String> {
    let mut candidates = command
        .subcommands()
        .flat_map(|sub| {
            std::iter::once(sub.name().to_owned()).chain(sub.aliases().map(ToOwned::to_owned))
        })
        .collect::<Vec<_>>();

    candidates.sort_unstable();
    candidates.dedup();

    nearest_candidates(input, candidates, 3)
}

/// Rank candidate strings by edit distance and keep the best few.
///
/// This helper is intentionally used only on diagnostic paths, never during
/// successful parsing. That means clarity matters more than squeezing out every
/// last microsecond, but it is still written to avoid unnecessary work:
///
/// - candidates are scored exactly once
/// - only candidates within `max_distance` are retained
/// - the final sort is deterministic and stable in meaning
fn nearest_candidates(input: &str, candidates: Vec<String>, max_distance: usize) -> Vec<String> {
    let mut ranked = candidates
        .into_iter()
        .map(|candidate| (edit_distance(input, &candidate), candidate))
        .filter(|(score, _)| *score <= max_distance)
        .collect::<Vec<_>>();

    ranked.sort_by(|(a_score, a), (b_score, b)| a_score.cmp(b_score).then(a.cmp(b)));

    ranked.into_iter().take(3).map(|(_, candidate)| candidate).collect()
}

/// Render a short human-readable list of suggestions.
///
/// The resulting string is intended for diagnostic notes such as:
///
/// - ``did you mean `build`?``
/// - ``did you mean `build` or `check`?``
/// - ``did you mean `build`, `check`, or `test`?``
fn format_suggestions(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => format!("`{one}`"),
        [a, b] => format!("`{a}` or `{b}`"),
        [a, b, c, ..] => format!("`{a}`, `{b}`, or `{c}`"),
    }
}

/// Return whether a raw token is worth treating as a subcommand candidate.
///
/// Today this is intentionally simple: anything that does not start with `-` is
/// considered plausible enough to merit a subcommand suggestion.
fn looks_like_subcommand_candidate(text: &str) -> bool {
    !text.starts_with('-')
}

/// Compute the Levenshtein edit distance between two strings.
///
/// This is used for friendly diagnostics such as "did you mean ...?" when an
/// option or subcommand is unknown.
///
/// A few deliberate implementation choices:
///
/// - It compares Unicode scalar values (`char`s), not raw bytes, so edits are
///   measured in human-facing characters rather than UTF-8 code units.
/// - It stores only two dynamic-programming rows at a time, which keeps memory
///   usage modest while preserving the classic Levenshtein behavior.
/// - It swaps the inputs so that the working row tracks the shorter side,
///   minimizing temporary allocation size.
///
/// Complexity:
///
/// - Time: `O(a.len() * b.len())` in characters
/// - Space: `O(min(a.len(), b.len()))` in characters
///
/// This function lives on a cold diagnostic path, so the goal is a pleasant
/// balance of correctness, readability, and reasonable efficiency.
fn edit_distance(a: &str, b: &str) -> usize {
    let mut a = a.chars().collect::<Vec<_>>();
    let mut b = b.chars().collect::<Vec<_>>();

    if a.len() < b.len() {
        std::mem::swap(&mut a, &mut b);
    }

    let mut previous = (0..=b.len()).collect::<Vec<_>>();
    let mut current = vec![0usize; b.len() + 1];

    for (i, a_ch) in a.iter().enumerate() {
        current[0] = i + 1;

        for (j, b_ch) in b.iter().enumerate() {
            let substitution_cost = usize::from(a_ch != b_ch);

            current[j + 1] =
                (previous[j + 1] + 1).min(current[j] + 1).min(previous[j] + substitution_cost);
        }

        std::mem::swap(&mut previous, &mut current);
    }

    previous[b.len()]
}

fn render_arg(command: CommandRef<'_>, arg: crate::ids::ArgId) -> String {
    let arg = crate::schema::ArgRef { schema: command.schema, id: arg };

    if let Some(long) = arg.long() {
        format!("--{long}")
    } else if let Some(short) = arg.short() {
        format!("-{short}")
    } else {
        arg.id_string().to_owned()
    }
}

fn render_command(command: CommandRef<'_>, id: crate::ids::CommandId) -> String {
    let cmd = crate::schema::CommandRef { schema: command.schema, id };

    cmd.name().to_owned()
}

fn render_group(command: CommandRef<'_>, id: crate::ids::GroupId) -> String {
    let group = crate::schema::GroupRef { schema: command.schema, id };

    group.id_string().to_owned()
}
