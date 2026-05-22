#![forbid(unsafe_code)]

pub mod app;
pub mod config;
pub mod db;
pub mod error;
pub mod files;
pub mod http;
pub mod observability;
pub mod runtime;
pub mod services;
pub mod shutdown;
pub mod state;

pub use app::{ServerApplication, ServerBuilder};
pub use config::{
    AppConfig, BlobConfig, ConfigOrigin, FilesConfig, HttpConfig, LoadedConfig, LogFormat,
    ObservabilityConfig, RawSurrealMode, RuntimeConfig, ServerConfig, SurrealAuth, SurrealConfig,
};
pub use db::service::DatabaseService;
pub use error::{AppError, AppResult, ConfigError, DbError, FileError};
pub use files::meta::{
    BlobHash, BlobId, BlobKind, BlobMedia, BlobName, BlobRecord, BlobSize, StagedBlob, StoredBlob,
};
pub use files::service::FileService;
pub use observability::init as init_observability;
pub use runtime::build_runtime;
pub use services::parser::{ParseSummary, ParserService};
pub use shutdown::{ShutdownCoordinator, ShutdownReason};
pub use state::{AppState, DbState, FileState, ParserState, ReadinessLevel, ReadinessSnapshot};
