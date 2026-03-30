//! Core schema-driven CLI parser.
//!
//! This parser consumes normalized tokens and produces raw matched command/arg
//! occurrences. It uses an iterative, non-recursive state loop for maximum
//! performance and defers errors so that `--help` can reliably bypass them.

use std::iter::Peekable;
use std::slice::Iter;

use crate::ids::LocalArgIndex;
use crate::parse::ValueId;
use crate::parse::error::{ParseError, ParseFailure};
use crate::parse::model::{
    CommandMatch, ParseOutput, RawValue, Span, ValueOccurrence, ValueOrigin,
};
use crate::parse::normalize::{NormalizedArgv, NormalizedToken};
use crate::parse::state::CommandState;
use crate::parse::validate::validate_command;
use crate::schema::{ArgRef, Command, CommandRef, LookupRef};

/// Parse normalized argv against a compiled command schema.
pub fn parse_command(command: &Command, input: NormalizedArgv) -> Result<ParseOutput, ParseError> {
    let parser = Parser::new(input.tokens(), input.values());
    let root_match = parser.parse(command.as_ref())?;

    Ok(ParseOutput {
        program: input.program().cloned(),
        root: root_match,
        values: input.values().clone(),
    })
}

/// Encapsulated parser state for the token stream.
struct Parser<'a> {
    iter: Peekable<Iter<'a, NormalizedToken>>,
    values: &'a crate::parse::model::ValueStore,
    commands: Vec<(crate::ids::CommandId, Box<[crate::parse::model::ArgMatch]>)>,
    first_error: Option<ParseError>,
    help_triggered: bool,
}

impl<'a> Parser<'a> {
    /// Initialize a new parser from the token stream.
    fn new(tokens: &'a [NormalizedToken], values: &'a crate::parse::model::ValueStore) -> Self {
        Self {
            iter: tokens.iter().peekable(),
            values,
            commands: Vec::new(),
            first_error: None,
            help_triggered: false,
        }
    }

    /// Execute the non-recursive parsing loop.
    fn parse(mut self, root_cmd: CommandRef<'a>) -> Result<CommandMatch, ParseError> {
        let mut current_cmd = root_cmd;

        loop {
            let mut state = CommandState::new(current_cmd);
            let mut next_cmd = None;

            while let Some(token) = self.iter.next() {
                match token {
                    NormalizedToken::Terminator { .. } => continue,
                    NormalizedToken::Long { name, span } => {
                        self.handle_long(current_cmd, &mut state, name, *span);
                    }
                    NormalizedToken::Short { name, span } => {
                        self.handle_short(current_cmd, &mut state, *name, *span);
                    }
                    NormalizedToken::Value { value, span } => {
                        if let Some(sub) = self.handle_value(current_cmd, &mut state, *value, *span)
                        {
                            next_cmd = Some(sub);
                            break;
                        }
                    }
                }

                if self.help_triggered {
                    break;
                }
            }

            // Validate the current command only if help was not triggered and no earlier error exists.
            if !self.help_triggered
                && self.first_error.is_none()
                && let Err(failure) = validate_command(current_cmd, &state)
            {
                self.first_error = Some(enrich_validation_error(current_cmd, failure));
            }

            self.commands.push((current_cmd.id(), state.freeze(current_cmd)));

            match next_cmd {
                Some(sub) if !self.help_triggered => current_cmd = sub,
                _ => break,
            }
        }

        // Surface deferred errors if help was not requested.
        if !self.help_triggered
            && let Some(err) = self.first_error
        {
            return Err(err);
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
                self.first_error.get_or_insert_with(|| unknown_long_error(cmd, name, span));
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
                self.first_error.get_or_insert_with(|| {
                    ParseFailure::UnknownShort { name, span }
                        .into_error(|a| render_arg(cmd, a), |c| render_command(cmd, c))
                });
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
            self.first_error.get_or_insert_with(|| unexpected_value_error(cmd, raw, span));
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
        if arg.action() == crate::builder::ArgAction::Help {
            let local = cmd.local_arg_by_id(arg.id()).expect("effective arg must have local slot");
            state.mark_seen(local);
            state.match_builder(local).push_flag(span);
            self.help_triggered = true;
            return;
        }

        if let Err(e) = parse_arg_occurrence(arg, cmd, state, &mut self.iter, span) {
            self.first_error.get_or_insert(e);
        }
    }
}

fn parse_arg_occurrence<'a>(
    arg: ArgRef<'_>,
    command: CommandRef<'_>,
    state: &mut CommandState,
    iter: &mut Peekable<Iter<'a, NormalizedToken>>,
    span: Span,
) -> Result<(), ParseError> {
    let local = command.local_arg_by_id(arg.id()).expect("effective arg must have local slot");

    state.mark_seen(local);

    if arg.takes_value() {
        if let Some(NormalizedToken::Value { value, span: value_span }) = iter.peek() {
            let value_copy = *value;
            let span_copy = *value_span;

            iter.next();

            let origin = match span_copy.part {
                crate::parse::model::SpanPart::AttachedValue => {
                    if matches!(span.part, crate::parse::model::SpanPart::LongName) {
                        ValueOrigin::AttachedLong
                    } else {
                        ValueOrigin::AttachedShort
                    }
                }
                _ => ValueOrigin::Separate,
            };

            state
                .match_builder(local)
                .push_value(span, ValueOccurrence { value: value_copy, span: span_copy, origin });
        } else {
            return Err(ParseFailure::MissingValue { arg: arg.id(), span }
                .into_error(|a| render_arg(command, a), |c| render_command(command, c))
                .with_help("pass a value after this option or use `--help`"));
        }
    } else {
        state.match_builder(local).push_flag(span);
    }

    Ok(())
}

fn unknown_long_error(command: CommandRef<'_>, name: &str, span: Span) -> ParseError {
    let suggestions = suggest_long(command, name);

    let mut err = ParseFailure::UnknownLong { name: name.into(), span }
        .into_error(|arg| render_arg(command, arg), |cmd| render_command(command, cmd))
        .with_help("try `--help` to see available options");

    if !suggestions.is_empty() {
        err = err.with_note(format!("did you mean {}?", format_suggestions(&suggestions)));
    }

    err
}

fn unexpected_value_error(cmd: CommandRef<'_>, raw: &RawValue, span: Span) -> ParseError {
    let text = raw.display().to_string();
    let mut err = ParseFailure::UnexpectedValue { value: text.into_boxed_str(), span }
        .into_error(|arg| render_arg(cmd, arg), |c| render_command(cmd, c))
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
    let mut err = failure.into_error(|arg| render_arg(cmd, arg), |c| render_command(cmd, c));

    match err.kind() {
        crate::parse::ParseErrorKind::MissingRequired
        | crate::parse::ParseErrorKind::Conflict
        | crate::parse::ParseErrorKind::Requires
        | crate::parse::ParseErrorKind::MissingValue => {
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
