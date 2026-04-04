//! Ergonomic access over raw parse output.

use std::marker::PhantomData;
use std::vec;

use crate::builder::ArgActionKind;
use crate::decode::{DecodeError, DecodeErrorKind, FromRawValue};
use crate::ids::ArgId;
use crate::matches::FromMatch;
use crate::parse::{
    ArgMatch, CommandMatch, Occurrence, ParseOutput, RawValue, ValueOccurrence, ValueStore,
};
use crate::runtime_error::ArgvSnapshot;
use crate::schema::{ArgRef, Command, CommandRef};

/// Borrowed view over one parsed command match plus the compiled schema.
///
/// This is the main ergonomic entry point for consuming raw parse output.
///
/// Lookups search the active command path from the root matched command through
/// the current matched command, so parent-command arguments remain visible from
/// nested subcommands.
#[derive(Clone, Copy, Debug)]
pub struct MatchRef<'a> {
    command: CommandRef<'a>,
    root: &'a CommandMatch,
    current: &'a CommandMatch,
    values: &'a ValueStore,
    snapshot: Option<&'a ArgvSnapshot>,
}

impl<'a> MatchRef<'a> {
    /// Constructs a `MatchRef` from a compiled command, matched command node,
    /// and shared value store.
    #[must_use]
    pub fn new(command: &'a Command, matched: &'a CommandMatch, values: &'a ValueStore) -> Self {
        Self { command: command.as_ref(), root: matched, current: matched, values, snapshot: None }
    }

    /// Constructs a `MatchRef` from explicit parts.
    #[must_use]
    pub fn from_parts(
        command: CommandRef<'a>,
        root: &'a CommandMatch,
        current: &'a CommandMatch,
        values: &'a ValueStore,
    ) -> Self {
        Self { command, root, current, values, snapshot: None }
    }

    /// Attaches an argv snapshot for diagnostic error reporting.
    #[must_use]
    pub fn with_snapshot(mut self, snapshot: &'a ArgvSnapshot) -> Self {
        self.snapshot = Some(snapshot);
        self
    }

    /// Prints a decode error with full diagnostic context and exits.
    pub fn exit_with_error(&self, err: DecodeError) -> ! {
        let runtime_err = crate::RuntimeError::Decode(err);

        if let Some(snapshot) = self.snapshot {
            let _ = runtime_err.eprint_with_argv(snapshot.clone());
        } else {
            let _ = runtime_err.eprint();
        }

        std::process::exit(2);
    }

    /// Returns the matched command view.
    #[must_use]
    pub fn command(&self) -> CommandRef<'a> {
        self.command
    }

    /// Returns the raw matched command node.
    #[must_use]
    pub fn raw(&self) -> &'a CommandMatch {
        self.current
    }

    /// Returns the shared value store.
    #[must_use]
    pub fn values(&self) -> &'a ValueStore {
        self.values
    }

    /// Returns the nested matched subcommand, if any.
    #[must_use]
    pub fn subcommand(&self) -> Option<Self> {
        let matched = self.current.subcommand.as_deref()?;
        let command = self
            .command
            .subcommands()
            .find(|sub| sub.id() == matched.command)
            .expect("matched subcommand id must exist in schema");

        Some(Self {
            command,
            root: self.root,
            current: matched,
            values: self.values,
            snapshot: self.snapshot,
        })
    }

    /// Returns the deepest matched subcommand if any, otherwise `self`.
    #[must_use]
    pub fn deepest_subcommand(self) -> Self {
        let mut current = self;
        while let Some(sub) = current.subcommand() {
            current = sub;
        }
        current
    }

    /// Returns the active subcommand name, if any.
    #[must_use]
    pub fn subcommand_name(&self) -> Option<&'a str> {
        self.subcommand().map(|cmd| cmd.command().name())
    }

    /// Returns `true` if the active subcommand has the provided name.
    #[must_use]
    pub fn subcommand_is(&self, name: &str) -> bool {
        self.subcommand_name() == Some(name)
    }

    /// Returns the active subcommand if it has the provided name.
    #[must_use]
    pub fn subcommand_of(&self, name: &str) -> Option<Self> {
        self.subcommand().filter(|cmd| cmd.command().name() == name)
    }

    /// Returns the active subcommand as a `(name, match)` pair.
    ///
    /// This is useful when matching directly in a single `match` expression:
    ///
    /// ```rust,ignore
    /// match root.subcommand_tuple() {
    ///     Some(("build", cmd)) => {
    ///         let cfg: BuildConfig = cmd.extract_or_exit();
    ///     }
    ///     Some(("run", cmd)) => {
    ///         let cfg: RunConfig = cmd.extract_or_exit();
    ///     }
    ///     Some((other, _)) => {
    ///         eprintln!("Unhandled subcommand: {other}");
    ///     }
    ///     None => {}
    /// }
    /// ```
    #[must_use]
    pub fn subcommand_tuple(&self) -> Option<(&'a str, Self)> {
        let cmd = self.subcommand()?;
        Some((cmd.command().name(), cmd))
    }

    /// Extracts a typed value from the active subcommand if it has the provided name.
    ///
    /// Returns `Ok(None)` if there is no active subcommand or if the active
    /// subcommand has a different name.
    pub fn subcommand_extract<T>(&self, name: &str) -> Result<Option<T>, DecodeError>
    where
        T: FromMatch,
    {
        self.subcommand_of(name).map(T::from_match).transpose()
    }

    /// Extracts a typed value from the active subcommand if it has the provided
    /// name, or exits with a diagnostic if decoding fails.
    pub fn subcommand_extract_or_exit<T>(&self, name: &str) -> Option<T>
    where
        T: FromMatch,
    {
        self.subcommand_extract(name).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Returns the command that requested help, if any.
    ///
    /// This prefers the deepest matched command with the synthesized help flag.
    #[must_use]
    pub fn requested_help_command(self) -> Option<CommandRef<'a>> {
        if let Some(sub) = self.subcommand()
            && let Some(found) = sub.requested_help_command()
        {
            return Some(found);
        }

        self.has_help_flag().then_some(self.command)
    }

    /// Iterates over parsed arg matches for this command.
    #[must_use]
    pub fn args(&self) -> impl ExactSizeIterator<Item = ArgMatchRef<'a>> {
        self.current.args.iter().map(|matched| {
            let arg = ArgRef { schema: self.command.schema, id: matched.arg };
            ArgMatchRef { arg, matched, values: self.values }
        })
    }

    /// Returns `true` if the arg with canonical id `id` is present.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if `id` is not a known effective arg id in this
    /// command view.
    pub fn contains(&self, id: &str) -> Result<bool, DecodeError> {
        Ok(self.arg(id)?.is_some())
    }

    /// Alias for [`Self::contains`].
    pub fn has(&self, id: &str) -> Result<bool, DecodeError> {
        self.contains(id)
    }

    /// Returns a boolean-style presence value for `id`.
    ///
    /// This is appropriate for valueless flags.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if the arg is unknown or is not a valueless flag.
    pub fn get_flag(&self, id: &str) -> Result<bool, DecodeError> {
        let arg = self.schema_arg(id)?;

        if arg.value_spec().is_some() {
            return Err(
                self.invalid_access(id, "cannot use get_flag() on an arg that takes values")
            );
        }

        Ok(self.arg_match(arg.id()).is_some())
    }

    /// Alias for [`Self::get_flag`].
    pub fn flag(&self, id: &str) -> Result<bool, DecodeError> {
        self.get_flag(id)
    }

    /// Returns a boolean-style presence value for `id`, or exits with error.
    pub fn get_flag_or_exit(&self, id: &str) -> bool {
        self.get_flag(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Alias for [`Self::get_flag_or_exit`].
    pub fn flag_or_exit(&self, id: &str) -> bool {
        self.get_flag_or_exit(id)
    }

    /// Returns the occurrence count for `id`.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if the arg is unknown.
    pub fn get_count(&self, id: &str) -> Result<u64, DecodeError> {
        let arg = self.schema_arg(id)?;
        Ok(self.arg_match(arg.id()).map_or(0, |matched| matched.occurrence_count() as u64))
    }

    /// Alias for [`Self::get_count`].
    pub fn count(&self, id: &str) -> Result<u64, DecodeError> {
        self.get_count(id)
    }

    /// Returns the occurrence count for `id`, or exits with error.
    pub fn get_count_or_exit(&self, id: &str) -> u64 {
        self.get_count(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Alias for [`Self::get_count_or_exit`].
    pub fn count_or_exit(&self, id: &str) -> u64 {
        self.get_count_or_exit(id)
    }

    /// Decodes zero or one typed value for `id`.
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
    pub fn value_of<T>(&self, id: &str) -> Result<Option<T>, DecodeError>
    where
        T: FromRawValue,
    {
        let arg = self.schema_arg(id)?;

        let Some(matched) = self.arg_match(arg.id()) else {
            return Ok(None);
        };

        let occurrence = self.single_occurrence(id, matched)?;
        let value = self.single_value(id, occurrence)?;

        self.decode_value::<T>(id, value).map(Some)
    }

    /// Decodes zero or one typed value for `id`, or exits with error.
    pub fn value_of_or_exit<T>(&self, id: &str) -> Option<T>
    where
        T: FromRawValue,
    {
        self.value_of(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Decodes exactly one typed value for `id`.
    ///
    /// This is the ergonomic companion to [`Self::value_of`] for args that are
    /// expected to be present exactly once at runtime.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if:
    ///
    /// - the arg is unknown
    /// - the arg is absent
    /// - the arg occurred multiple times
    /// - the occurrence contains zero or multiple values
    /// - the raw value fails to decode as `T`
    pub fn require<T>(&self, id: &str) -> Result<T, DecodeError>
    where
        T: FromRawValue,
    {
        self.value_of(id)?.ok_or_else(|| {
            DecodeError::new(
                DecodeErrorKind::MissingValue,
                Some(id),
                None,
                format!("expected a value for `{id}`"),
            )
        })
    }

    /// Decodes exactly one typed value for `id`, or exits with error.
    pub fn require_or_exit<T>(&self, id: &str) -> T
    where
        T: FromRawValue,
    {
        self.require(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Returns one raw value for `id`, if present.
    pub fn raw_value_of(&self, id: &str) -> Result<Option<RawValue>, DecodeError> {
        self.value_of(id)
    }

    /// Returns one raw value for `id`, if present, or exits with error.
    pub fn raw_value_of_or_exit(&self, id: &str) -> Option<RawValue> {
        self.value_of_or_exit(id)
    }

    /// Returns all raw values for `id` as an iterator.
    pub fn raw_values_of(&self, id: &str) -> Result<Values<RawValue>, DecodeError> {
        self.values_of(id)
    }

    /// Returns all raw values for `id` as an iterator, or exits with error.
    pub fn raw_values_of_or_exit(&self, id: &str) -> Values<RawValue> {
        self.values_of_or_exit(id)
    }

    /// Decodes all values for `id` and returns them as an iterator.
    ///
    /// If the arg is absent, returns an empty iterator.
    ///
    /// This is the preferred API for repeated values. Callers can collect into
    /// any container they want:
    ///
    /// ```rust,ignore
    /// let features = matches.values_of::<String>("feature")?.collect::<Vec<_>>();
    /// let unique = matches
    ///     .values_of::<String>("feature")?
    ///     .collect::<std::collections::HashSet<_>>();
    /// ```
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if the arg is unknown or any raw value fails to
    /// decode.
    pub fn values_of<T>(&self, id: &str) -> Result<Values<T>, DecodeError>
    where
        T: FromRawValue,
    {
        let arg = self.schema_arg(id)?;

        let Some(matched) = self.arg_match(arg.id()) else {
            return Ok(Values::empty());
        };

        let values = self
            .value_occurrences(matched)
            .map(|occurrence| self.decode_value::<T>(id, occurrence))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Values::new(values))
    }

    /// Decodes all values for `id` and returns them as an iterator, or exits
    /// with error.
    pub fn values_of_or_exit<T>(&self, id: &str) -> Values<T>
    where
        T: FromRawValue,
    {
        self.values_of(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Compatibility alias for [`Self::value_of`].
    pub fn get_one<T>(&self, id: &str) -> Result<Option<T>, DecodeError>
    where
        T: FromRawValue,
    {
        self.value_of(id)
    }

    /// Compatibility alias for [`Self::value_of_or_exit`].
    pub fn get_one_or_exit<T>(&self, id: &str) -> Option<T>
    where
        T: FromRawValue,
    {
        self.value_of_or_exit(id)
    }

    /// Compatibility helper that decodes all values for `id` into any standard
    /// collection.
    ///
    /// New code should generally prefer [`Self::values_of`].
    pub fn get_many<C, T>(&self, id: &str) -> Result<C, DecodeError>
    where
        C: FromIterator<T>,
        T: FromRawValue,
    {
        Ok(self.values_of::<T>(id)?.collect())
    }

    /// Compatibility helper that decodes all values for `id` into a collection,
    /// or exits with error.
    ///
    /// New code should generally prefer [`Self::values_of_or_exit`].
    pub fn get_many_or_exit<C, T>(&self, id: &str) -> C
    where
        C: FromIterator<T>,
        T: FromRawValue,
    {
        self.get_many(id).unwrap_or_else(|err| self.exit_with_error(err))
    }

    /// Compatibility convenience for returning one raw value for `id`, if present.
    pub fn get_one_raw(&self, id: &str) -> Result<Option<RawValue>, DecodeError> {
        self.raw_value_of(id)
    }

    /// Compatibility convenience for returning all raw values for `id`.
    pub fn get_many_raw(&self, id: &str) -> Result<Vec<RawValue>, DecodeError> {
        Ok(self.raw_values_of(id)?.collect())
    }

    /// Returns the matched `ArgMatchRef` for `id`, if present.
    ///
    /// # Errors
    ///
    /// Returns [`DecodeError`] if `id` is not a known effective arg id.
    pub fn arg(&self, id: &str) -> Result<Option<ArgMatchRef<'a>>, DecodeError> {
        let arg = self.schema_arg(id)?;
        Ok(self.arg_match(arg.id()).map(|matched| ArgMatchRef {
            arg,
            matched,
            values: self.values,
        }))
    }

    /// Extracts a strongly typed value from this matched command.
    pub fn extract<T: FromMatch>(self) -> Result<T, DecodeError> {
        T::from_match(self)
    }

    /// Extracts a strongly typed value from this matched command, or exits with
    /// a diagnostic if decoding fails.
    pub fn extract_or_exit<T: FromMatch>(self) -> T {
        self.extract().unwrap_or_else(|err| self.exit_with_error(err))
    }

    fn has_help_flag(self) -> bool {
        self.find_schema_arg("__help").and_then(|arg| self.arg_match(arg.id())).is_some()
    }

    fn find_schema_arg(&self, id: &str) -> Option<ArgRef<'a>> {
        self.command.args().find(|arg| arg.id_string() == id)
    }

    fn schema_arg(&self, id: &str) -> Result<ArgRef<'a>, DecodeError> {
        self.find_schema_arg(id).ok_or_else(|| {
            DecodeError::new(
                DecodeErrorKind::UnknownArg,
                Some(id),
                None,
                format!("unknown arg id `{id}` in command `{}`", self.command.name()),
            )
        })
    }

    fn invalid_access(&self, id: &str, message: &'static str) -> DecodeError {
        DecodeError::new(DecodeErrorKind::InvalidAccess, Some(id), None, message)
    }

    fn arg_match(&self, id: ArgId) -> Option<&'a ArgMatch> {
        let mut current = self.root;

        loop {
            if let Some(matched) = current.args.iter().find(|matched| matched.arg == id) {
                return Some(matched);
            }

            if std::ptr::eq(current, self.current) {
                break;
            }

            match &current.subcommand {
                Some(sub) => current = sub.as_ref(),
                None => break,
            }
        }

        None
    }

    fn single_occurrence(
        &self,
        id: &str,
        matched: &'a ArgMatch,
    ) -> Result<&'a Occurrence, DecodeError> {
        match matched.occurrences.as_ref() {
            [] => unreachable!("present arg match must contain at least one occurrence"),
            [occurrence] => Ok(occurrence),
            occurrences => Err(DecodeError::new(
                DecodeErrorKind::TooManyOccurrences,
                Some(id),
                None,
                format!("expected at most one occurrence of `{id}`, found {}", occurrences.len()),
            )),
        }
    }

    fn single_value(
        &self,
        id: &str,
        occurrence: &'a Occurrence,
    ) -> Result<&'a ValueOccurrence, DecodeError> {
        match occurrence.values.as_ref() {
            [] => Err(DecodeError::new(
                DecodeErrorKind::MissingValue,
                Some(id),
                Some(occurrence.span),
                format!("argument `{id}` did not contain a value"),
            )),
            [value] => Ok(value),
            values => Err(DecodeError::new(
                DecodeErrorKind::TooManyValues,
                Some(id),
                Some(occurrence.span),
                format!("expected one value for `{id}`, found {}", values.len()),
            )),
        }
    }

    fn value_occurrences(
        &self,
        matched: &'a ArgMatch,
    ) -> impl Iterator<Item = &'a ValueOccurrence> + 'a {
        matched.occurrences.iter().flat_map(|occurrence| occurrence.values.iter())
    }

    fn decode_value<T>(&self, id: &str, occurrence: &'a ValueOccurrence) -> Result<T, DecodeError>
    where
        T: FromRawValue,
    {
        let raw = self.values.get(occurrence.value);

        T::from_raw_value(raw).map_err(|err| {
            err.with_arg(id.to_owned())
                .with_span(occurrence.span)
                .with_value(raw.display().to_string())
        })
    }
}

/// Iterator over decoded values for one argument.
///
/// This is returned by [`MatchRef::values_of`] and [`MatchRef::values_of_or_exit`].
#[derive(Debug)]
pub struct Values<T> {
    inner: vec::IntoIter<T>,
    _marker: PhantomData<T>,
}

impl<T> Values<T> {
    fn new(values: Vec<T>) -> Self {
        Self { inner: values.into_iter(), _marker: PhantomData }
    }

    fn empty() -> Self {
        Self::new(Vec::new())
    }
}

impl<T> Iterator for Values<T> {
    type Item = T;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<T> ExactSizeIterator for Values<T> {
    fn len(&self) -> usize {
        self.inner.len()
    }
}

impl<T> DoubleEndedIterator for Values<T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.inner.next_back()
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
    /// Returns the canonical schema arg.
    #[must_use]
    pub fn arg(&self) -> ArgRef<'a> {
        self.arg
    }

    /// Returns the raw matched arg node.
    #[must_use]
    pub fn raw(&self) -> &'a ArgMatch {
        self.matched
    }

    /// Returns the number of occurrences.
    #[must_use]
    pub fn occurrence_count(&self) -> usize {
        self.matched.occurrence_count()
    }

    /// Returns `true` if this arg is present.
    #[must_use]
    pub fn is_present(&self) -> bool {
        self.matched.is_present()
    }

    /// Iterates over all value occurrences across all arg occurrences.
    pub fn values(&self) -> impl Iterator<Item = ValueMatchRef<'a>> {
        self.matched
            .occurrences
            .iter()
            .flat_map(|occurrence| occurrence.values.iter())
            .map(|value| ValueMatchRef { value, store: self.values })
    }

    /// Returns the semantic action for this arg.
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
    /// Returns the raw stored value.
    #[must_use]
    pub fn raw(&self) -> &'a RawValue {
        self.store.get(self.value.value)
    }

    /// Returns the value occurrence metadata.
    #[must_use]
    pub fn occurrence(&self) -> &'a ValueOccurrence {
        self.value
    }
}

impl ParseOutput {
    /// Borrows the root match as a typed decode view.
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
    use std::collections::HashSet;

    use super::*;
    use crate::builder::{ArgAction, ArgBuilder, CommandBuilder};
    use crate::parse::{Argv, parse_command, tokenize_argv};

    #[derive(Debug, PartialEq, Eq)]
    struct BuildConfig {
        features: HashSet<String>,
    }

    impl FromMatch for BuildConfig {
        fn from_match(m: MatchRef<'_>) -> Result<Self, DecodeError> {
            Ok(Self { features: m.values_of::<String>("feature")?.collect() })
        }
    }

    fn parsed_fixture() -> (Command, ParseOutput) {
        let command = CommandBuilder::new("demo")
            .arg(ArgBuilder::flag("verbose").short('v').long("verbose").action(ArgAction::Count))
            .arg(ArgBuilder::option::<String>("config").long("config"))
            .arg(ArgBuilder::option::<String>("feature").long("feature").action(ArgAction::Append))
            .arg(ArgBuilder::positional::<String>("input").position(0))
            .subcommand(CommandBuilder::new("build").arg(
                ArgBuilder::option::<String>("feature").long("feature").action(ArgAction::Append),
            ))
            .build()
            .expect("schema should build");

        let argv = Argv::from_argv([
            "demo",
            "--verbose",
            "--config",
            "app.toml",
            "input.txt",
            "build",
            "--feature",
            "a",
            "--feature",
            "b",
        ]);
        let tokenized = tokenize_argv(argv);
        let parsed = parse_command(&command, tokenized).expect("parse");

        (command, parsed)
    }

    #[test]
    fn contains_and_count_work() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        assert!(root.contains("verbose").expect("contains should work"));
        assert!(root.has("verbose").expect("has should work"));
        assert_eq!(root.get_count("verbose").expect("count should work"), 1);
        assert_eq!(root.count("verbose").expect("count alias should work"), 1);

        let err = root.contains("missing").expect_err("unknown arg should error");
        assert_eq!(err.kind(), DecodeErrorKind::UnknownArg);
    }

    #[test]
    fn value_of_decodes_string() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let config: Option<String> = root.value_of("config").expect("decode should work");
        assert_eq!(config.as_deref(), Some("app.toml"));
    }

    #[test]
    fn raw_value_of_reads_positional() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let input = root
            .raw_value_of("input")
            .expect("raw decode should work")
            .expect("input should be present");

        assert_eq!(input.try_as_str(), Ok("input.txt"));
    }

    #[test]
    fn values_of_collects_into_any_collection() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);
        let build = root.subcommand_of("build").expect("build should be active");

        let values =
            build.values_of::<String>("feature").expect("decode should work").collect::<Vec<_>>();
        assert_eq!(values, vec!["a".to_owned(), "b".to_owned()]);

        let set = build
            .values_of::<String>("feature")
            .expect("decode should work")
            .collect::<HashSet<_>>();
        assert_eq!(set.len(), 2);
        assert!(set.contains("a"));
        assert!(set.contains("b"));
    }

    #[test]
    fn require_returns_exactly_one_value() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let input: String = root.require("input").expect("required value should decode");
        assert_eq!(input, "input.txt");
    }

    #[test]
    fn subcommand_helpers_work() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        assert_eq!(root.subcommand_name(), Some("build"));
        assert!(root.subcommand_is("build"));
        assert!(root.subcommand_of("build").is_some());
        assert!(root.subcommand_of("run").is_none());

        let (name, cmd) = root.subcommand_tuple().expect("subcommand should exist");
        assert_eq!(name, "build");

        let cfg = cmd.extract::<BuildConfig>().expect("build config should decode");
        assert!(cfg.features.contains("a"));
        assert!(cfg.features.contains("b"));
    }

    #[test]
    fn subcommand_extract_works() {
        let (command, parsed) = parsed_fixture();
        let root = parsed.root_ref(&command);

        let cfg = root
            .subcommand_extract::<BuildConfig>("build")
            .expect("subcommand extraction should succeed")
            .expect("build should be active");

        assert!(cfg.features.contains("a"));
        assert!(cfg.features.contains("b"));

        let absent = root
            .subcommand_extract::<BuildConfig>("run")
            .expect("mismatched subcommand should not error");
        assert!(absent.is_none());
    }
}
