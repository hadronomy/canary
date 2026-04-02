//! Core schema-driven CLI parser.
//!
//! This parser consumes raw tokenized argv and normalizes tokens on the fly
//! against the active command schema. It produces raw matched command/arg
//! occurrences using an iterative, non-recursive state loop for maximum
//! performance and defers errors so that `--help` can reliably bypass them.

use std::collections::VecDeque;

use crate::ids::LocalArgIndex;
use crate::parse::error::{ParseError, ParseErrorKind, ParseFailure};
use crate::parse::model::{
    CommandMatch, NormalizedToken, ParseOutput, RawValue, Span, SpanPart, ValueId, ValueOccurrence,
    ValueOrigin,
};
use crate::parse::state::CommandState;
use crate::parse::token::{RawToken, TokenizedArgv};
use crate::parse::validate::validate_command;
use crate::schema::{ArgRef, Command, CommandRef, LookupRef};

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
    /// A mutable builder enabling us to dynamically inject environment and default values.
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

    /// Peek at the next normalized token using the current subcommand's schema.
    fn peek_token(&mut self, current_cmd: CommandRef<'a>) -> Option<NormalizedToken> {
        self.fill_buffer(current_cmd);
        self.normalized_buffer.front().cloned()
    }

    /// Consume the next normalized token using the current subcommand's schema.
    fn next_token(&mut self, current_cmd: CommandRef<'a>) -> Option<NormalizedToken> {
        self.fill_buffer(current_cmd);
        self.normalized_buffer.pop_front()
    }

    /// Read raw tokens and normalize them until the buffer has at least one token,
    /// or we run out of input.
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
                    } else if let Err(e) = self.normalize_option_like(current_cmd, value, span) {
                        self.errors.push(e);
                    }
                }
            }
        }
    }

    /// Schema-aware normalization for an option-like string (e.g., `-v`, `--config=file`).
    fn normalize_option_like(
        &mut self,
        cmd: CommandRef<'a>,
        value_id: ValueId,
        span: Span,
    ) -> Result<(), ParseError> {
        let text = {
            let raw = self.values.get(value_id);
            raw.try_as_str().map(ToOwned::to_owned).map_err(|err| {
                ParseError::new(
                    ParseErrorKind::NonUtf8OptionLike,
                    Some(span),
                    format!("option-like argv entry must be valid UTF-8: {err}"),
                )
            })?
        };

        // Now we can safely mutate `self` using slices of our local owned String
        if let Some(rest) = text.strip_prefix("--") {
            self.normalize_long(span, rest)
        } else if let Some(rest) = text.strip_prefix('-') {
            self.normalize_short_cluster(cmd, span, rest)
        } else {
            self.normalized_buffer.push_back(NormalizedToken::Value {
                value: value_id,
                span: Span { arg_index: span.arg_index, part: SpanPart::BareValue },
            });
            Ok(())
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

        let iter = rest.char_indices();

        for (byte_offset, short) in iter {
            let arg = match cmd.lookup_short(short) {
                Some(LookupRef::Arg(arg)) => arg,
                Some(LookupRef::Subcommand(_)) => {
                    return Err(ParseError::new(
                        ParseErrorKind::UnknownShort,
                        Some(span),
                        format!("short option `-{short}` resolved unexpectedly to a subcommand"),
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

                    // We consumed the rest of the cluster as an attached value.
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

            while let Some(token) = self.next_token(current_cmd) {
                match token {
                    NormalizedToken::Terminator { .. } => continue,
                    NormalizedToken::Long { name, span } => {
                        self.handle_long(current_cmd, &mut state, &name, span);
                    }
                    NormalizedToken::Short { name, span } => {
                        self.handle_short(current_cmd, &mut state, name, span);
                    }
                    NormalizedToken::Value { value, span } => {
                        if let Some(sub) = self.handle_value(current_cmd, &mut state, value, span) {
                            next_cmd = Some((sub, span));
                            break;
                        }
                    }
                }

                if self.help_triggered {
                    break;
                }
            }

            // Apply environment variables and defaults before validation!
            // This is the magic that makes fallbacks completely seamless to the end user.
            if !self.help_triggered {
                for (local, arg, _) in current_cmd.local_args() {
                    if !state.is_seen(local) {
                        // 1. Try Environment Variables
                        if let Some(env_name) = arg.env()
                            && let Some(val) = std::env::var_os(env_name)
                        {
                            if !arg.takes_value() {
                                let lower = val.to_string_lossy().to_lowercase();
                                if lower == "0" || lower == "false" || lower.is_empty() {
                                    continue;
                                }
                                if arg.action() == crate::builder::ArgActionKind::Count
                                    && let Ok(count) = val.to_string_lossy().parse::<usize>()
                                {
                                    state.mark_seen(local);
                                    for _ in 0..count {
                                        state.match_builder(local).push_flag(Span {
                                            arg_index: 0,
                                            part: SpanPart::Environment,
                                        });
                                    }
                                    continue;
                                }
                            }

                            let value_id = self.values.push(RawValue::from(val));
                            state.mark_seen(local);
                            if arg.takes_value() {
                                state.match_builder(local).push_value(
                                    Span { arg_index: 0, part: SpanPart::Environment },
                                    ValueOccurrence {
                                        value: value_id,
                                        span: Span { arg_index: 0, part: SpanPart::Environment },
                                        origin: ValueOrigin::Environment,
                                    },
                                );
                            } else {
                                state
                                    .match_builder(local)
                                    .push_flag(Span { arg_index: 0, part: SpanPart::Environment });
                            }
                            continue;
                        }

                        // 2. Try Schema Defaults
                        if let Some(spec) = arg.value_spec()
                            && let Some(crate::schema::DefaultValueRef::String(def)) =
                                spec.default()
                        {
                            let value_id = self.values.push(RawValue::from(def));
                            state.mark_seen(local);
                            state.match_builder(local).push_value(
                                Span { arg_index: 0, part: SpanPart::Default },
                                ValueOccurrence {
                                    value: value_id,
                                    span: Span { arg_index: 0, part: SpanPart::Default },
                                    origin: ValueOrigin::Default,
                                },
                            );
                        }
                    }
                }

                // Now validate. Accumulate the error instead of crashing!
                if let Err(failure) =
                    validate_command(current_cmd, &state, self.values, current_cmd_span)
                {
                    self.errors.push(enrich_validation_error(current_cmd, failure));
                }
            }

            // Validate the current command only if help was not triggered and no earlier error exists.
            if !self.help_triggered
                && self.errors.is_empty()
                && let Err(failure) =
                    validate_command(current_cmd, &state, self.values, current_cmd_span)
            {
                self.errors.push(enrich_validation_error(current_cmd, failure));
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

        // Surface deferred errors if help was not requested.
        if !self.help_triggered && !self.errors.is_empty() {
            return Err(self.errors);
        }

        // Fold the flattened array back into the nested `CommandMatch` tree structure idiomatically.
        let root_match = self.commands.into_iter().rfold(None, |subcommand, (command, args)| {
            Some(Box::new(CommandMatch { command, args, subcommand }))
        });

        Ok(*root_match.expect("parser must produce at least one command match"))
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
                    |a| render_arg(cmd, a),
                    |c| render_command(cmd, c),
                    |g| render_group(cmd, g),
                ));
            }
        }
    }

    fn handle_value(
        &mut self,
        cmd: CommandRef<'a>,
        state: &mut CommandState,
        value: ValueId,
        span: Span,
    ) -> Option<CommandRef<'a>> {
        let raw = self.values.get(value);

        // Check if it's a subcommand first.
        if let Ok(text) = raw.try_as_str()
            && let Some(LookupRef::Subcommand(sub)) = cmd.lookup_subcommand(text)
        {
            return Some(sub);
        }

        // Otherwise, try to bind as a positional argument.
        if let Some((local, _arg)) = next_positional(cmd, state) {
            state.mark_seen(local);
            state
                .match_builder(local)
                .push_value(span, ValueOccurrence { value, span, origin: ValueOrigin::Positional });
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
        if arg.action() == crate::builder::ArgActionKind::Help {
            let local = cmd.local_arg_by_id(arg.id()).expect("effective arg must have local slot");
            state.mark_seen(local);
            state.match_builder(local).push_flag(span);
            self.help_triggered = true;
            return;
        }

        if let Err(e) = self.parse_arg_occurrence(arg, cmd, state, span) {
            self.errors.push(e);
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

        if arg.takes_value() {
            if let Some(NormalizedToken::Value { value, span: value_span }) =
                self.peek_token(command)
            {
                let value_copy = value;
                let span_copy = value_span;

                self.next_token(command); // Consume it!

                let origin = match span_copy.part {
                    SpanPart::AttachedValue => {
                        if matches!(span.part, SpanPart::LongName) {
                            ValueOrigin::AttachedLong
                        } else {
                            ValueOrigin::AttachedShort
                        }
                    }
                    _ => ValueOrigin::Separate,
                };

                state.match_builder(local).push_value(
                    span,
                    ValueOccurrence { value: value_copy, span: span_copy, origin },
                );
            } else {
                return Err(ParseFailure::MissingValue { arg: arg.id(), span }
                    .into_error(
                        |a| render_arg(command, a),
                        |c| render_command(command, c),
                        |g| render_group(command, g),
                    )
                    .with_help("pass a value after this option or use `--help`"));
            }
        } else {
            state.match_builder(local).push_flag(span);
        }

        Ok(())
    }
}

fn unknown_long_error(command: CommandRef<'_>, name: &str, span: Span) -> ParseError {
    let suggestions = suggest_long(command, name);

    let mut err = ParseFailure::UnknownLong { name: name.into(), span }
        .into_error(
            |arg| render_arg(command, arg),
            |cmd| render_command(command, cmd),
            |g| render_group(command, g),
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
            |c| render_command(cmd, c),
            |g| render_group(cmd, g),
        )
        .with_help("try `--help` to see supported arguments");

    if let Ok(s) = raw.try_as_str()
        && looks_like_subcommand_candidate(s)
    {
        let suggestions = suggest_subcommand(cmd, s);
        if !suggestions.is_empty() {
            err = err.with_note(format!("did you mean {}?", format_suggestions(&suggestions)));
        }
    }

    err
}

fn enrich_validation_error(cmd: CommandRef<'_>, failure: ParseFailure) -> ParseError {
    let mut err = failure.into_error(
        |arg| render_arg(cmd, arg),
        |c| render_command(cmd, c),
        |g| render_group(cmd, g),
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
    let mut candidates: Vec<String> = command
        .args()
        .flat_map(|arg| {
            let mut out = Vec::new();
            if let Some(long) = arg.long() {
                out.push(long.to_owned());
            }
            out.extend(arg.aliases().map(|alias| alias.name().to_owned()));
            out
        })
        .collect();

    candidates.sort();
    candidates.dedup();

    nearest_candidates(input, candidates, 3)
}

fn suggest_subcommand(command: CommandRef<'_>, input: &str) -> Vec<String> {
    let mut candidates: Vec<String> = command
        .subcommands()
        .flat_map(|sub| {
            let mut out = vec![sub.name().to_owned()];
            out.extend(sub.aliases().map(ToOwned::to_owned));
            out
        })
        .collect();

    candidates.sort();
    candidates.dedup();

    nearest_candidates(input, candidates, 3)
}

fn nearest_candidates(input: &str, candidates: Vec<String>, max_distance: usize) -> Vec<String> {
    let mut ranked: Vec<_> = candidates
        .into_iter()
        .map(|candidate| {
            let score = edit_distance(input, &candidate);
            (score, candidate)
        })
        .filter(|(score, _)| *score <= max_distance)
        .collect();

    ranked.sort_by(|(a_score, a), (b_score, b)| a_score.cmp(b_score).then(a.cmp(b)));
    ranked.into_iter().take(3).map(|(_, candidate)| candidate).collect()
}

fn format_suggestions(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => format!("`{one}`"),
        [a, b] => format!("`{a}` or `{b}`"),
        [a, b, c, ..] => format!("`{a}`, `{b}`, or `{c}`"),
    }
}

fn looks_like_subcommand_candidate(text: &str) -> bool {
    !text.starts_with('-')
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<_> = a.chars().collect();
    let b: Vec<_> = b.chars().collect();

    let mut dp = vec![vec![0usize; b.len() + 1]; a.len() + 1];

    for (i, row) in dp.iter_mut().enumerate() {
        row[0] = i;
    }

    for (j, cell) in dp[0].iter_mut().enumerate() {
        *cell = j;
    }

    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            dp[i][j] = (dp[i - 1][j] + 1).min(dp[i][j - 1] + 1).min(dp[i - 1][j - 1] + cost);
        }
    }

    dp[a.len()][b.len()]
}

fn next_positional<'a>(
    command: CommandRef<'a>,
    state: &CommandState,
) -> Option<(LocalArgIndex, ArgRef<'a>)> {
    command.local_args().find_map(|(local, arg, _)| {
        (arg.kind() == crate::builder::ArgKind::Positional && !state.is_seen(local))
            .then_some((local, arg))
    })
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
