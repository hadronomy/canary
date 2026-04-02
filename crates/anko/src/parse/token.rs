//! Lexical argv tokenization.
//!
//! Tokenization here is intentionally shallow:
//!
//! - it classifies argv entries
//! - it preserves whole raw values
//! - it does not yet split long/short syntax into parser-ready pieces
//!
//! That finer-grained work belongs to schema-aware normalization.

use crate::parse::argv::Argv;
use crate::parse::model::{RawValue, Span, SpanPart, ValueId, ValueStore, ValueStoreBuilder};

/// A shallow lexical token over argv.
///
/// This tokenization stage preserves whole raw values and only classifies args
/// into broad categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RawToken {
    /// A raw value that might represent an option or option cluster.
    ///
    /// Examples:
    ///
    /// - `--verbose`
    /// - `--config=file`
    /// - `-v`
    /// - `-abc`
    /// - `-ofile`
    OptionLike {
        /// Whole raw argv value.
        value: ValueId,
        /// Where this argv entry came from.
        span: Span,
    },

    /// A bare raw value.
    Value {
        /// Whole raw argv value.
        value: ValueId,
        /// Where this argv entry came from.
        span: Span,
    },

    /// The `--` terminator.
    Terminator {
        /// Where this argv entry came from.
        span: Span,
    },
}

/// Tokenized argv.
///
/// This is the output of the lexical tokenization stage.
#[derive(Clone, Debug)]
pub struct TokenizedArgv {
    program: Option<RawValue>,
    values: ValueStore,
    tokens: Box<[RawToken]>,
}

impl TokenizedArgv {
    /// Return the program name, if any.
    #[must_use]
    pub fn program(&self) -> Option<&RawValue> {
        self.program.as_ref()
    }

    /// Return the stored raw values.
    #[must_use]
    pub fn values(&self) -> &ValueStore {
        &self.values
    }

    /// Return the lexical tokens.
    #[must_use]
    pub fn tokens(&self) -> &[RawToken] {
        &self.tokens
    }

    /// Iterate over lexical tokens.
    #[must_use]
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &RawToken> {
        self.tokens.iter()
    }

    pub(crate) fn into_parts(self) -> (Option<RawValue>, ValueStore, Box<[RawToken]>) {
        (self.program, self.values, self.tokens)
    }
}

/// Lexical tokenizer.
#[derive(Debug, Default, Clone, Copy)]
pub struct Tokenizer;

impl Tokenizer {
    /// Create a new tokenizer.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Tokenize argv into a shallow lexical representation.
    #[must_use]
    pub fn tokenize(self, argv: Argv) -> TokenizedArgv {
        tokenize_argv(argv)
    }
}

/// Tokenize argv into a shallow lexical representation.
#[must_use]
pub fn tokenize_argv(argv: Argv) -> TokenizedArgv {
    let (program, args) = argv.into_parts();

    let mut values = ValueStoreBuilder::new();
    let mut tokens = Vec::<RawToken>::with_capacity(args.len());

    for (index, arg) in args.into_vec().into_iter().enumerate() {
        let span = Span {
            arg_index: u32::try_from(index).expect("argv index overflow"),
            part: SpanPart::Whole,
        };

        if arg.is_double_dash() {
            tokens.push(RawToken::Terminator { span: Span { part: SpanPart::Terminator, ..span } });
            continue;
        }

        let value = values.push(arg.clone());

        if arg.is_single_dash() || !arg.starts_with_dash() {
            tokens
                .push(RawToken::Value { value, span: Span { part: SpanPart::BareValue, ..span } });
        } else {
            tokens.push(RawToken::OptionLike { value, span });
        }
    }

    TokenizedArgv { program, values: values.freeze(), tokens: tokens.into_boxed_slice() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_classifies_basic_argv() {
        let tokenized =
            tokenize_argv(Argv::from_argv(["prog", "--verbose", "-abc", "--", "-", "file"]));

        assert_eq!(tokenized.tokens().len(), 5);

        assert!(matches!(tokenized.tokens()[0], RawToken::OptionLike { .. }));
        assert!(matches!(tokenized.tokens()[1], RawToken::OptionLike { .. }));
        assert!(matches!(tokenized.tokens()[2], RawToken::Terminator { .. }));
        assert!(matches!(tokenized.tokens()[3], RawToken::Value { .. }));
        assert!(matches!(tokenized.tokens()[4], RawToken::Value { .. }));
    }
}
