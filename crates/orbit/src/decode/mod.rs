//! Typed decode and extraction over raw parse output.
//!
//! This module sits above the raw parser and below any future derive-based API.
//!
//! It provides:
//!
//! - typed conversion from [`crate::parse::RawValue`] via [`FromRawValue`]
//! - ergonomic match inspection via [`MatchRef`]
//! - decode errors via [`DecodeError`]
//!
//! Typical flow:
//!
//! ```rust,ignore
//! let tokenized = tokenize_argv(argv);
//! let normalized = normalize_for_command(command.as_ref(), tokenized)?;
//! let parsed = parse_command(&command, normalized)?;
//!
//! let root = MatchRef::new(&command, &parsed.root, &parsed.values);
//! let verbose = root.get_count("verbose")?;
//! let config: Option<std::path::PathBuf> = root.get_one("config")?;
//! ```
//!
//! This layer intentionally does not yet populate user structs directly. That is
//! the job of a future derive or high-level decode API.

mod error;
mod from_value;
mod matches;

pub use error::{DecodeError, DecodeErrorKind};
pub use from_value::FromRawValue;
pub use matches::{ArgMatchRef, MatchRef, ValueMatchRef};