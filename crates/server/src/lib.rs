#![forbid(unsafe_code)]

pub mod app;
pub mod config;
pub mod db;
pub mod error;
pub mod files;
pub mod http;
pub mod observability;
pub mod pagination;
pub mod runtime;
pub mod services;
pub mod shutdown;
pub mod state;

pub use app::{ServerApplication, ServerBuilder};
pub use config::{
    AppConfig, BlobConfig, ConfigOrigin, FileBackendConfig, FilesConfig, HttpConfig, LoadedConfig,
    LocalFileConfig, LogFormat, ObjectPrefix, ObservabilityConfig, RawSurrealMode, RuntimeConfig,
    S3AddressingStyle, S3Credentials, S3FileConfig, ServerConfig, SurrealAuth, SurrealConfig,
    TransportSecurity,
};
pub use db::service::DatabaseService;
pub use error::{AppError, AppResult, ConfigError, DbError, FileError, ServerError, ServerResult};
pub use files::list::ListBlobs;
pub use files::meta::{
    BlobHash, BlobId, BlobKey, BlobKind, BlobMedia, BlobName, BlobRecord, BlobSize, StagedBlob,
    StoredBlob,
};
pub use files::service::{BlobService, FileService, UploadService};
pub use files::upload::{
    ActorId, PartNumber, UploadAccess, UploadHeader, UploadMode, UploadPurpose, UploadSession,
    UploadState,
};
pub use http::extract::Pagination;
pub use observability::init as init_observability;
pub use pagination::{
    DefaultPagePolicy, Limit, Page, PagePolicy, PagePolicySource, PageQuery, PageRequest,
    PageWindow, Paginated, PaginationError,
};
pub use runtime::build_runtime;
pub use services::parser::{ParseSummary, ParserService};
pub use shutdown::{ShutdownCoordinator, ShutdownReason};
pub use state::{AppState, DbState, FileState, ParserState, ReadinessLevel, ReadinessSnapshot};
