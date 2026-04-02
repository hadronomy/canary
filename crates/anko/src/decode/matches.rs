//! Ergonomic access over raw parse output.

use crate::builder::ArgActionKind;
use crate::decode::{DecodeError, DecodeErrorKind, FromRawValue};
use crate::ids::ArgId;
use crate::parse::{ArgMatch, CommandMatch, ParseOutput, RawValue, ValueOccurrence, ValueStore};
use crate::schema::{ArgRef, Command, CommandRef};

/// Borrowed view over one parsed command match plus the compiled schema.
///
/// This is the main ergonomic entry point for consuming raw parse output.
///
/// # Examples
///
/// ```rust,ignore
/// let parsed = parse_command(&command, normalized)?;
/// let root = MatchRef::new(&command, &parsed.root, &parsed.values);
///
/// let verbose = root.get_count("verbose")?;
/// let config: Option<std::path::PathBuf> = root.get_one("config")?;
/// ```
#[derive(Clone, Copy, Debug)]
pub struct MatchRef<'a> {
    command: CommandRef<'a>,
    root_matched: &'a CommandMatch,
    matched: &'a CommandMatch,
    values: &'a ValueStore,
    snapshot: Option<&'a crate::runtime_error::ArgvSnapshot>,
}

impl<'a> MatchRef<'a> {
    /// Construct a `MatchRef` from a compiled command, matched command node, and
    /// shared value store.
    #[must_use]
    pub fn new(command: &'a Command, matched: &'a CommandMatch, values: &'a ValueStore) -> Self {
        Self { command: command.as_ref(), root_matched: matched, matched, values, snapshot: None }
    }

    /// Construct a `MatchRef` from a command view directly.
    #[must_use]
    pub fn from_parts(
        command: CommandRef<'a>,
        root_matched: &'a CommandMatch,
        matched: &'a CommandMatch,
        values: &'a ValueStore,
    ) -> Self {
        Self { command, root_matched, matched, values, snapshot: None }
    }

    /// Attach an argv snapshot for beautiful diagnostic errors.
    #[must_use]
    pub fn with_snapshot(mut self, snapshot: &'a crate::runtime_error::ArgvSnapshot) -> Self {
        self.snapshot = Some(snapshot);
        self
    }

    /// Print a decode error with full diagnostic context and exit.
    pub fn exit_with_error(&self, err: DecodeError) -> ! {
        let runtime_err = crate::RuntimeError::Decode(err);
        if let Some(snapshot) = self.snapshot {
            let _ = runtime_err.eprint_with_argv(snapshot.clone());
        } else {
            let _ = runtime_err.eprint();
        }
        std::process::exit(2);
    }

    /// Return the matched command view.
    #[must_use]
    pub fn command(&self) -> CommandRef<'a> {
        self.command
    }

    /// Return the raw matched command node.
    #[must_use]
    pub fn raw(&self) -> &'a CommandMatch {
        self.matched
    }

    /// Return the shared value store.
    #[must_use]
    pub fn values(&self) -> &'a ValueStore {
        self.values
    }

    /// Return the nested subcommand match, if any.
    #[must_use]
    pub fn subcommand(&self) -> Option<Self> {
        let matched = self.matched.subcommand.as_deref()?;
        let command = self
            .command
            .subcommands()
            .find(|sub| sub.id() == matched.command)
            .expect("matched subcommand id must exist in schema");

        let mut next = Self::from_parts(command, self.root_matched, matched, self.values);
        next.snapshot = self.snapshot;
        Some(next)
    }

    /// Return the deepest matched subcommand if any, otherwise `self`.
    #[must_use]
    pub fn deepest_subcommand(self) -> Self {
        let mut current = self;
        while let Some(sub) = current.subcommand() {
            current = sub;
        }
        current
    }

    /// Return the command that requested help, if any.
    ///
    /// This recursively prefers the deepest matched command that has the
    /// synthesized help flag present.
    #[must_use]
    pub fn requested_help_command(self) -> Option<CommandRef<'a>> {
        if let Some(sub) = self.subcommand()
            && let Some(found) = sub.requested_help_command()
        {
            return Some(found);
        }

        self.has_help_flag().then_some(self.command)
    }

    /// Iterate over parsed arg matches for this command.
    #[must_use]
    pub fn args(&self) -> impl ExactSizeIterator<Item = ArgMatchRef<'a>> {
        self.matched.args.iter().map(|matched| {
            let arg = ArgRef { schema: self.command.schema, id: matched.arg };

            ArgMatchRef { arg, matched, values: self.values }
        })
    }

    /// Return `true` if the arg with canonical id `id` is present.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if `id` is not a known effective arg id in this
    /// command view.
    pub fn contains(&self, id: &str) -> Result<bool, DecodeError> {
        Ok(self.arg_match_by_id(id)?.is_some())
    }

    /// Return a boolean-style presence value for `id`.
    ///
    /// This is appropriate for flag-like args.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if the arg is unknown or is not a valueless flag.
    pub fn get_flag(&self, id: &str) -> Result<bool, DecodeError> {
        let arg = self.schema_arg_by_id(id)?;

        if arg.value_spec().is_some() {
            return Err(DecodeError::new(
                DecodeErrorKind::InvalidAccess,
                Some(id),
                None,
                "cannot use get_flag() on an arg that takes values",
            ));
        }

        Ok(self.arg_match_by_arg(arg.id()).is_some())
    }

    /// Return a boolean-style presence value for `id`, or exit with error.
    pub fn get_flag_or_exit(&self, id: &str) -> bool {
        self.get_flag(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Return the occurrence count for `id`.
    ///
    /// This is appropriate for count-style flags.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if the arg is unknown.
    pub fn get_count(&self, id: &str) -> Result<u64, DecodeError> {
        let arg = self.schema_arg_by_id(id)?;

        if let Some(matched) = self.arg_match_by_arg(arg.id()) {
            Ok(matched.occurrence_count() as u64)
        } else {
            Ok(0)
        }
    }

    /// Return the occurrence count for `id`, or exit with error.
    pub fn get_count_or_exit(&self, id: &str) -> u64 {
        self.get_count(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Decode zero or one typed value for `id`.
    ///
    /// If the arg is absent, returns `Ok(None)`.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if:
    ///
    /// - the arg is unknown
    /// - the arg occurred multiple times
    /// - the occurrence contains multiple values
    /// - the raw value fails to decode as `T`
    pub fn get_one<T>(&self, id: &str) -> Result<Option<T>, DecodeError>
    where
        T: FromRawValue,
    {
        let arg = self.schema_arg_by_id(id)?;

        let Some(matched) = self.arg_match_by_arg(arg.id()) else {
            return Ok(None);
        };

        if matched.occurrences.len() > 1 {
            return Err(DecodeError::new(
                DecodeErrorKind::TooManyOccurrences,
                Some(id),
                None,
                format!(
                    "expected at most one occurrence of `{id}`, found {}",
                    matched.occurrences.len()
                ),
            ));
        }

        let occurrence = &matched.occurrences[0];

        if occurrence.values.is_empty() {
            return Err(DecodeError::new(
                DecodeErrorKind::MissingValue,
                Some(id),
                Some(occurrence.span),
                format!("argument `{id}` did not contain a value"),
            ));
        }

        if occurrence.values.len() > 1 {
            return Err(DecodeError::new(
                DecodeErrorKind::TooManyValues,
                Some(id),
                Some(occurrence.span),
                format!("expected one value for `{id}`, found {}", occurrence.values.len()),
            ));
        }

        let value_occurrence = &occurrence.values[0];
        let value = self.values.get(value_occurrence.value);

        T::from_raw_value(value).map(Some).map_err(|err| {
            err.with_arg(id.to_owned())
                .with_span(value_occurrence.span)
                .with_value(value.display().to_string())
        })
    }

    /// Decode zero or one typed value for `id`, or exit with error.
    pub fn get_one_or_exit<T>(&self, id: &str) -> Option<T>
    where
        T: FromRawValue,
    {
        self.get_one(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Decode all values for `id` into any standard collection.
    ///
    /// If the arg is absent, returns an empty collection.
    ///
    /// # Errors
    /// Returns [`DecodeError`] if the arg is unknown or any raw value fails to decode.
    pub fn get_many<C, T>(&self, id: &str) -> Result<C, DecodeError>
    where
        C: FromIterator<T>,
        T: FromRawValue,
    {
        let arg = self.schema_arg_by_id(id)?;

        let Some(matched) = self.arg_match_by_arg(arg.id()) else {
            // Return an empty collection seamlessly
            return Ok(std::iter::empty().collect());
        };

        // Magically iterate, decode, and collect the Result stream straight into C!
        matched
            .occurrences
            .iter()
            .flat_map(|occ| &*occ.values)
            .map(|val| {
                let raw = self.values.get(val.value);
                T::from_raw_value(raw)
                    .map_err(|err| err.with_arg(id.to_owned()).with_span(val.span))
            })
            .collect::<Result<C, DecodeError>>()
    }

    /// Decode all values for `id` into a collection, or exit with error.
    pub fn get_many_or_exit<C, T>(&self, id: &str) -> C
    where
        C: FromIterator<T>,
        T: FromRawValue,
    {
        self.get_many(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Return one raw value for `id`, if present.
    ///
    /// This is a convenience over `get_one::<RawValue>()`.
    pub fn get_one_raw(&self, id: &str) -> Result<Option<RawValue>, DecodeError> {
        self.get_one::<RawValue>(id)
    }

    /// Return all raw values for `id`.
    ///
    /// This is a convenience over `get_many::<RawValue>()`.
    pub fn get_many_raw(&self, id: &str) -> Result<Vec<RawValue>, DecodeError> {
        self.get_many::<Vec<RawValue>, RawValue>(id)
    }

    /// Return the matched `ArgMatchRef` for `id`, if present.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if `id` is not a known effective arg id.
    pub fn arg(&self, id: &str) -> Result<Option<ArgMatchRef<'a>>, DecodeError> {
        let arg = self.schema_arg_by_id(id)?;
        Ok(self.arg_match_by_arg(arg.id()).map(|matched| ArgMatchRef {
            arg,
            matched,
            values: self.values,
        }))
    }

    fn has_help_flag(self) -> bool {
        self.find_schema_arg_by_id("__help")
            .and_then(|arg| self.arg_match_by_arg(arg.id()))
            .is_some()
    }

    fn find_schema_arg_by_id(&self, id: &str) -> Option<ArgRef<'a>> {
        self.command.args().find(|arg| arg.id_string() == id)
    }

    fn schema_arg_by_id(&self, id: &str) -> Result<ArgRef<'a>, DecodeError> {
        self.find_schema_arg_by_id(id).ok_or_else(|| {
            DecodeError::new(
                DecodeErrorKind::UnknownArg,
                Some(id),
                None,
                format!("unknown arg id `{id}` in command `{}`", self.command.name()),
            )
        })
    }

    fn arg_match_by_id(&self, id: &str) -> Result<Option<&'a ArgMatch>, DecodeError> {
        let arg = self.schema_arg_by_id(id)?;
        Ok(self.arg_match_by_arg(arg.id()))
    }

    fn arg_match_by_arg(&self, id: ArgId) -> Option<&'a ArgMatch> {
        let mut current = self.root_matched;

        loop {
            // 1. Check if the argument was captured at this level of the tree
            if let Some(m) = current.args.iter().find(|m| m.arg == id) {
                return Some(m);
            }

            // 2. Stop searching once we've checked the node this MatchRef represents
            if std::ptr::eq(current, self.matched) {
                break;
            }

            // 3. Otherwise, traverse down the actively parsed subcommand path
            match &current.subcommand {
                Some(sub) => current = sub.as_ref(),
                None => break, // Should never happen on a valid active path
            }
        }

        None
    }
}

/// Borrowed view over one parsed arg match plus schema metadata.
#[derive(Clone, Copy, Debug)]
pub struct ArgMatchRef<'a> {
    arg: ArgRef<'a>,
    matched: &'a ArgMatch,
    values: &'a ValueStore,
}

impl<'a> ArgMatchRef<'a> {
    /// Return the canonical schema arg.
    #[must_use]
    pub fn arg(&self) -> ArgRef<'a> {
        self.arg
    }

    /// Return the raw matched arg node.
    #[must_use]
    pub fn raw(&self) -> &'a ArgMatch {
        self.matched
    }

    /// Return the number of occurrences.
    #[must_use]
    pub fn occurrence_count(&self) -> usize {
        self.matched.occurrence_count()
    }

    /// Return `true` if this arg is present.
    #[must_use]
    pub fn is_present(&self) -> bool {
        self.matched.is_present()
    }

    /// Iterate over all value occurrences across all arg occurrences.
    pub fn values(&self) -> impl Iterator<Item = ValueMatchRef<'a>> {
        self.matched
            .occurrences
            .iter()
            .flat_map(|occurrence| occurrence.values.iter())
            .map(|value| ValueMatchRef { value, store: self.values })
    }

    /// Return the semantic action for this arg.
    #[must_use]
    pub fn action(&self) -> ArgActionKind {
        self.arg.action()
    }
}

/// Borrowed view over one raw matched value.
#[derive(Clone, Copy, Debug)]
pub struct ValueMatchRef<'a> {
    value: &'a ValueOccurrence,
    store: &'a ValueStore,
}

impl<'a> ValueMatchRef<'a> {
    /// Return the raw stored value.
    #[must_use]
    pub fn raw(&self) -> &'a RawValue {
        self.store.get(self.value.value)
    }

    /// Return the value occurrence metadata.
    #[must_use]
    pub fn occurrence(&self) -> &'a ValueOccurrence {
        self.value
    }
}

impl ParseOutput {
    /// Borrow the root match as a typed decode view.
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// let view = parsed.root_ref(&command);
    /// let verbose = view.get_count("verbose")?;
    /// ```
    #[must_use]
    pub fn root_ref<'a>(&'a self, command: &'a Command) -> MatchRef<'a> {
        MatchRef::new(command, &self.root, &self.values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder::{ArgAction, ArgBuilder, CommandBuilder};
    use crate::parse::{Argv, parse_command, tokenize_argv};

    fn parsed_fixture() -> (Command, ParseOutput) {
        let command = CommandBuilder::new("demo")
            .arg(ArgBuilder::flag("verbose").short('v').long("verbose").action(ArgAction::Count))
            .arg(ArgBuilder::option::<String>("config").long("config"))
            .arg(ArgBuilder::positional::<String>("input").position(0))
            .build()
            .expect("schema should build");

        let argv = Argv::from_argv(["demo", "--verbose", "--config", "app.toml", "input.txt"]);
        let tokenized = tokenize_argv(argv);
        let parsed = parse_command(&command, tokenized).expect("parse");

        (command, parsed)
    }

    #[test]
    fn contains_and_count_work() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        assert!(root.contains("verbose").expect("contains should work"));
        assert_eq!(root.get_count("verbose").expect("count should work"), 1);

        let err = root.contains("missing").expect_err("unknown arg should error");
        assert_eq!(err.kind(), DecodeErrorKind::UnknownArg);
    }

    #[test]
    fn get_one_decodes_string() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let config: Option<String> = root.get_one("config").expect("decode should work");
        assert_eq!(config.as_deref(), Some("app.toml"));
    }

    #[test]
    fn get_one_raw_reads_positional() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let input = root
            .get_one_raw("input")
            .expect("raw decode should work")
            .expect("input should be present");

        assert_eq!(input.try_as_str(), Ok("input.txt"));
    }
}
