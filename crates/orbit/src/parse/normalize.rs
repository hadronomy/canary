//! Schema-aware token normalization.
//!
//! This stage takes shallow lexical tokens and lowers them into a parser-ready
//! flat token stream using the current command schema.
//!
//! Examples:
//!
//! - `--verbose` -> `Long("verbose")`
//! - `--config=file` -> `Long("config"), Value("file")`
//! - `-abc` -> `Short('a'), Short('b'), Short('c')`
//! - `-ofile` where `-o` is an option -> `Short('o'), Value("file")`
//!
//! This is not full parsing. It does not:
//!
//! - consume subcommands
//! - bind values semantically
//! - validate required/conflicts
//! - build final parse matches
//!
//! It only produces a flat normalized token stream suitable for a parser.
//!
//! # Why schema-aware normalization?
//!
//! Long options are mostly syntactically unambiguous, but short clusters are
//! not. For example:
//!
//! - `-abc` might mean `-a -b -c`
//! - `-ofile` might mean `-o file` if `-o` takes a value
//!
//! So normalization needs access to the active command schema in order to know
//! whether a short option accepts a value.
//!
//! # UTF-8 note
//!
//! Raw values remain OS-native and may be non-UTF8.
//!
//! However, option spellings themselves are interpreted as syntax. Since command
//! names and long option names are UTF-8 schema metadata, any argv entry that is
//! treated as an option spelling must be valid UTF-8.
//!
//! Therefore:
//!
//! - bare values may be non-UTF8
//! - option-like argv entries must be UTF-8 to be normalized as options

use std::fmt;

use thiserror::Error;

use crate::parse::model::{
    NonUtf8Value, RawValue, Span, SpanPart, ValueId, ValueStore, ValueStoreBuilder,
};
use crate::parse::token::{RawToken, TokenizedArgv};
use crate::schema::{ArgRef, CommandRef, LookupRef};

/// A parser-ready normalized token.
///
/// This is the output of schema-aware normalization.
///
/// Long and short option names are decoded into explicit tokens, while raw
/// values still refer into the shared [`ValueStore`].
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum NormalizedToken {
    /// A long option name without leading `--`.
    Long {
        /// Long option spelling.
        name: Box<str>,
        /// Where the long name came from.
        span: Span,
    },

    /// A short option name.
    Short {
        /// Short option character.
        name: char,
        /// Where the short name came from.
        span: Span,
    },

    /// A raw value token.
    Value {
        /// Stored raw value ID.
        value: ValueId,
        /// Where the value came from.
        span: Span,
    },

    /// The `--` terminator.
    Terminator {
        /// Where the terminator came from.
        span: Span,
    },
}

/// Parser-ready normalized argv.
#[derive(Clone, Debug)]
pub struct NormalizedArgv {
    program: Option<RawValue>,
    values: ValueStore,
    tokens: Box<[NormalizedToken]>,
}

impl NormalizedArgv {
    /// Return the program name, if any.
    #[must_use]
    pub fn program(&self) -> Option<&RawValue> {
        self.program.as_ref()
    }

    /// Return the shared raw value store.
    #[must_use]
    pub fn values(&self) -> &ValueStore {
        &self.values
    }

    /// Return the normalized tokens.
    #[must_use]
    pub fn tokens(&self) -> &[NormalizedToken] {
        &self.tokens
    }

    /// Iterate over normalized tokens.
    #[must_use]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &NormalizedToken> {
        self.tokens.iter()
    }

    /// Return the number of normalized tokens.
    #[must_use]
    pub fn len(&self) -> usize {
        self.tokens.len()
    }

    /// Return `true` if there are no normalized tokens.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }
}

/// Normalization error.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{kind} at argv[{arg_index}]: {message}")]
pub struct NormalizeError {
    kind: NormalizeErrorKind,
    arg_index: u32,
    message: Box<str>,
}

impl NormalizeError {
    #[must_use]
    pub fn new(kind: NormalizeErrorKind, arg_index: u32, message: impl Into<Box<str>>) -> Self {
        Self { kind, arg_index, message: message.into() }
    }

    /// Return the error category.
    #[must_use]
    pub fn kind(&self) -> NormalizeErrorKind {
        self.kind
    }

    /// Return the argv index where the error occurred.
    #[must_use]
    pub fn arg_index(&self) -> u32 {
        self.arg_index
    }

    /// Return the human-readable message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Category of normalization error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum NormalizeErrorKind {
    /// An option-like argv entry was not valid UTF-8.
    NonUtf8OptionLike,
    /// A long option spelling was malformed.
    InvalidLongSyntax,
    /// A short option was not recognized in the current command view.
    UnknownShort,
}

impl NormalizeErrorKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NonUtf8OptionLike => "non-utf8 option-like argument",
            Self::InvalidLongSyntax => "invalid long option syntax",
            Self::UnknownShort => "unknown short option",
        }
    }
}

impl fmt::Display for NormalizeErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Schema-aware argv normalizer.
#[derive(Debug, Default, Clone, Copy)]
pub struct Normalizer;

impl Normalizer {
    /// Create a new normalizer.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Normalize tokenized argv against the given command view.
    ///
    /// # Errors
    ///
    /// Returns [`NormalizeError`] if normalization requires schema knowledge
    /// that cannot be satisfied, for example for an unknown short option or an
    /// invalid UTF-8 option-like token.
    pub fn normalize(
        self,
        command: CommandRef<'_>,
        tokenized: TokenizedArgv,
    ) -> Result<NormalizedArgv, NormalizeError> {
        normalize_for_command(command, tokenized)
    }
}

/// Normalize tokenized argv against the given command view.
///
/// # Errors
///
/// Returns [`NormalizeError`] if normalization fails.
pub fn normalize_for_command(
    command: CommandRef<'_>,
    tokenized: TokenizedArgv,
) -> Result<NormalizedArgv, NormalizeError> {
    let (program, source_values, raw_tokens) = tokenized.into_parts();
    let mut values = ValueStoreBuilder::from_store(&source_values);
    let mut normalized = Vec::<NormalizedToken>::new();
    let mut after_terminator = false;

    for token in raw_tokens.iter().copied() {
        match token {
            RawToken::Terminator { span } => {
                normalized.push(NormalizedToken::Terminator { span });
                after_terminator = true;
            }

            RawToken::Value { value, span } => {
                normalized.push(NormalizedToken::Value { value, span });
            }

            RawToken::OptionLike { value, span } => {
                if after_terminator {
                    normalized.push(NormalizedToken::Value {
                        value,
                        span: Span { arg_index: span.arg_index, part: SpanPart::BareValue },
                    });
                } else {
                    normalize_option_like(
                        command,
                        &source_values,
                        &mut values,
                        &mut normalized,
                        value,
                        span,
                    )?;
                }
            }
        }
    }

    Ok(NormalizedArgv { program, values: values.freeze(), tokens: normalized.into_boxed_slice() })
}

fn normalize_option_like(
    command: CommandRef<'_>,
    source_values: &ValueStore,
    out_values: &mut ValueStoreBuilder,
    out_tokens: &mut Vec<NormalizedToken>,
    value_id: ValueId,
    span: Span,
) -> Result<(), NormalizeError> {
    let raw = source_values.get(value_id);
    let text = raw.try_as_str().map_err(|err| non_utf8_option_like(span, err))?;

    if let Some(rest) = text.strip_prefix("--") {
        normalize_long(out_values, out_tokens, span, rest)
    } else if let Some(rest) = text.strip_prefix('-') {
        normalize_short_cluster(command, out_values, out_tokens, span, rest)
    } else {
        out_tokens.push(NormalizedToken::Value {
            value: value_id,
            span: Span { arg_index: span.arg_index, part: SpanPart::BareValue },
        });
        Ok(())
    }
}

fn normalize_long(
    out_values: &mut ValueStoreBuilder,
    out_tokens: &mut Vec<NormalizedToken>,
    span: Span,
    rest: &str,
) -> Result<(), NormalizeError> {
    if rest.is_empty() {
        return Err(NormalizeError::new(
            NormalizeErrorKind::InvalidLongSyntax,
            span.arg_index,
            "long option name must not be empty",
        ));
    }

    match rest.split_once('=') {
        Some((name, attached)) => {
            if name.is_empty() {
                return Err(NormalizeError::new(
                    NormalizeErrorKind::InvalidLongSyntax,
                    span.arg_index,
                    "long option name must not be empty",
                ));
            }

            out_tokens.push(NormalizedToken::Long {
                name: name.into(),
                span: Span { arg_index: span.arg_index, part: SpanPart::LongName },
            });

            let value = out_values.push(RawValue::from(attached));
            out_tokens.push(NormalizedToken::Value {
                value,
                span: Span { arg_index: span.arg_index, part: SpanPart::AttachedValue },
            });

            Ok(())
        }
        None => {
            out_tokens.push(NormalizedToken::Long {
                name: rest.into(),
                span: Span { arg_index: span.arg_index, part: SpanPart::LongName },
            });
            Ok(())
        }
    }
}

fn normalize_short_cluster(
    command: CommandRef<'_>,
    out_values: &mut ValueStoreBuilder,
    out_tokens: &mut Vec<NormalizedToken>,
    span: Span,
    rest: &str,
) -> Result<(), NormalizeError> {
    if rest.is_empty() {
        return Err(NormalizeError::new(
            NormalizeErrorKind::UnknownShort,
            span.arg_index,
            "short option cluster must not be empty",
        ));
    }

    let chars = rest.char_indices().collect::<Vec<_>>();
    let mut i = 0usize;

    while i < chars.len() {
        let (byte_offset, short) = chars[i];
        let arg = lookup_short_arg(command, short, span.arg_index)?;

        out_tokens.push(NormalizedToken::Short {
            name: short,
            span: Span { arg_index: span.arg_index, part: SpanPart::ShortName },
        });

        if arg_takes_value(arg) {
            let value_start = byte_offset + short.len_utf8();
            if value_start < rest.len() {
                let attached = &rest[value_start..];
                let value = out_values.push(RawValue::from(attached));

                out_tokens.push(NormalizedToken::Value {
                    value,
                    span: Span { arg_index: span.arg_index, part: SpanPart::AttachedValue },
                });

                return Ok(());
            }
        }

        i += 1;
    }

    Ok(())
}

fn lookup_short_arg(
    command: CommandRef<'_>,
    short: char,
    arg_index: u32,
) -> Result<ArgRef<'_>, NormalizeError> {
    match command.lookup_short(short) {
        Some(LookupRef::Arg(arg)) => Ok(arg),
        Some(LookupRef::Subcommand(_)) => Err(NormalizeError::new(
            NormalizeErrorKind::UnknownShort,
            arg_index,
            format!("short option `-{short}` resolved unexpectedly to a subcommand"),
        )),
        None => Err(NormalizeError::new(
            NormalizeErrorKind::UnknownShort,
            arg_index,
            format!("unknown short option `-{short}`"),
        )),
    }
}

fn arg_takes_value(arg: ArgRef<'_>) -> bool {
    arg.value_spec().is_some()
}

fn non_utf8_option_like(span: Span, err: NonUtf8Value) -> NormalizeError {
    NormalizeError::new(
        NormalizeErrorKind::NonUtf8OptionLike,
        span.arg_index,
        format!("option-like argv entry must be valid UTF-8: {err}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder::{ArgBuilder, CommandBuilder};
    use crate::parse::tokenize_argv;

    fn command() -> crate::Command {
        CommandBuilder::new("acme")
            .arg(ArgBuilder::flag("verbose").short('v').long("verbose"))
            .arg(ArgBuilder::flag("all").short('a').long("all"))
            .arg(ArgBuilder::flag("beta").short('b').long("beta"))
            .arg(ArgBuilder::option::<String>("output").short('o').long("output"))
            .arg(ArgBuilder::option::<String>("config").long("config"))
            .build()
            .expect("test schema should build")
    }

    #[test]
    fn normalize_long_flag() {
        let command = command();
        let root = command.as_ref();

        let tokenized = tokenize_argv(crate::parse::Argv::from_argv(["prog", "--verbose"]));

        let normalized = normalize_for_command(root, tokenized).expect("normalize should work");

        assert_eq!(normalized.tokens().len(), 1);
        match &normalized.tokens()[0] {
            NormalizedToken::Long { name, .. } => {
                assert_eq!(name.as_ref(), "verbose");
            }
            other => panic!("unexpected token: {other:?}"),
        }
    }

    #[test]
    fn normalize_long_attached_value() {
        let command = command();
        let root = command.as_ref();

        let tokenized =
            tokenize_argv(crate::parse::Argv::from_argv(["prog", "--config=file.toml"]));

        let normalized = normalize_for_command(root, tokenized).expect("normalize should work");

        assert_eq!(normalized.tokens().len(), 2);

        match &normalized.tokens()[0] {
            NormalizedToken::Long { name, .. } => {
                assert_eq!(name.as_ref(), "config");
            }
            other => panic!("unexpected token: {other:?}"),
        }

        match &normalized.tokens()[1] {
            NormalizedToken::Value { value, .. } => {
                assert_eq!(normalized.values().get(*value).try_as_str(), Ok("file.toml"));
            }
            other => panic!("unexpected token: {other:?}"),
        }
    }

    #[test]
    fn normalize_short_cluster_of_flags() {
        let command = command();
        let root = command.as_ref();

        let tokenized = tokenize_argv(crate::parse::Argv::from_argv(["prog", "-vab"]));

        let normalized = normalize_for_command(root, tokenized).expect("normalize should work");

        let shorts = normalized
            .tokens()
            .iter()
            .map(|token| match token {
                NormalizedToken::Short { name, .. } => *name,
                other => panic!("unexpected token: {other:?}"),
            })
            .collect::<Vec<_>>();

        assert_eq!(shorts, vec!['v', 'a', 'b']);
    }

    #[test]
    fn normalize_short_with_attached_value() {
        let command = command();
        let root = command.as_ref();

        let tokenized = tokenize_argv(crate::parse::Argv::from_argv(["prog", "-ofile.txt"]));

        let normalized = normalize_for_command(root, tokenized).expect("normalize should work");

        assert_eq!(normalized.tokens().len(), 2);

        match normalized.tokens()[0] {
            NormalizedToken::Short { name, .. } => assert_eq!(name, 'o'),
            ref other => panic!("unexpected token: {other:?}"),
        }

        match normalized.tokens()[1] {
            NormalizedToken::Value { value, .. } => {
                assert_eq!(normalized.values().get(value).try_as_str(), Ok("file.txt"));
            }
            ref other => panic!("unexpected token: {other:?}"),
        }
    }

    #[test]
    fn terminator_switches_to_bare_values() {
        let command = command();
        let root = command.as_ref();

        let tokenized =
            tokenize_argv(crate::parse::Argv::from_argv(["prog", "--", "--verbose", "-v"]));

        let normalized = normalize_for_command(root, tokenized).expect("normalize should work");

        assert_eq!(normalized.tokens().len(), 3);

        assert!(matches!(normalized.tokens()[0], NormalizedToken::Terminator { .. }));
        assert!(matches!(normalized.tokens()[1], NormalizedToken::Value { .. }));
        assert!(matches!(normalized.tokens()[2], NormalizedToken::Value { .. }));
    }

    #[test]
    fn unknown_short_is_rejected() {
        let command = command();
        let root = command.as_ref();

        let tokenized = tokenize_argv(crate::parse::Argv::from_argv(["prog", "-z"]));

        let err = normalize_for_command(root, tokenized).expect_err("unknown short should fail");

        assert_eq!(err.kind(), NormalizeErrorKind::UnknownShort);
    }

    #[test]
    fn empty_long_name_is_rejected() {
        let command = command();
        let root = command.as_ref();

        let tokenized = tokenize_argv(crate::parse::Argv::from_argv(["prog", "--=value"]));

        let err =
            normalize_for_command(root, tokenized).expect_err("invalid long syntax should fail");

        assert_eq!(err.kind(), NormalizeErrorKind::InvalidLongSyntax);
    }
}
