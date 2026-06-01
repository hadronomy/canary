mod api;
mod config;
mod files;
mod server;

use std::error::Error as StdError;

pub use api::{AppError, AppResult, FieldError};
pub use config::ConfigError;
pub use database::Error as DbError;
pub use files::FileError;
pub use server::{ServerError, ServerResult};

pub(super) type SourceError = Box<dyn StdError + Send + Sync + 'static>;
