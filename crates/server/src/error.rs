mod api;
mod config;
mod db;
mod files;
mod server;

use std::error::Error as StdError;

pub use api::{AppError, AppResult, FieldError};
pub use config::ConfigError;
pub use db::DbError;
pub use files::FileError;
pub use server::{ServerError, ServerResult};

pub(super) type SourceError = Box<dyn StdError + Send + Sync + 'static>;
