#![forbid(unsafe_code)]

mod bitmask;
pub mod builder;
pub mod compiler;
pub mod decode;
pub mod diagnostic;
pub mod error;
pub mod help;
pub mod ids;
mod matches;
pub mod parse;
pub mod runtime_diagnostic;
mod runtime_error;
pub mod schema;
pub mod string_pool;

pub use decode::*;
pub use help::*;
pub use matches::{FromMatch, Matches};
pub use runtime_error::RuntimeError;

pub use crate::error::*;
pub use crate::schema::*;
