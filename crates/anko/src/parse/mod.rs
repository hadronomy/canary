//! Parse-layer foundations.
//!
//! This module contains the runtime parsing pipeline below typed decode and
//! above the immutable compiled schema.
//!
//! Current responsibilities:
//!
//! - argv capture
//! - raw OS-native value storage
//! - shallow lexical tokenization
//! - schema-aware normalization
//! - raw command/arg matching
//! - parse-time validation
//! - parse result model
//! - parse errors
//!
//! Intentionally not included yet:
//!
//! - typed decode into user structs
//! - shell completions
//! - help rendering
//! - config/env layering
//! - custom `chumsky` value grammars
//!
//! Suggested flow:
//!
//! ```text
//! Argv
//!   -> TokenizedArgv
//!   -> NormalizedArgv
//!   -> ParseOutput
//! ```
//!
//! Typical usage:
//!
//! ```rust,ignore
//! use crate::parse::{parse_command, tokenize_argv, normalize_for_command, Argv};
//!
//! let command = builder.build()?;
//! let argv = Argv::from_argv(["prog", "--verbose", "file.txt"]);
//! let tokenized = tokenize_argv(argv);
//! let normalized = normalize_for_command(command.as_ref(), tokenized)?;
//! let output = parse_command(&command, normalized)?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod argv;
mod error;
mod model;
mod parser;
mod state;
mod token;
mod validate;

pub use argv::Argv;
pub use error::{ParseError, ParseErrorKind};
pub use model::{
    ArgMatch, CommandMatch, NonUtf8Value, Occurrence, ParseOutput, RawValue, RawValueDisplay, Span,
    SpanPart, ValueId, ValueOccurrence, ValueOrigin, ValueStore,
};
pub use parser::parse_command;
pub use token::{RawToken, TokenizedArgv, Tokenizer, tokenize_argv};
