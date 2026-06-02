#![forbid(unsafe_code)]

pub mod app;
pub mod banner;
mod build {
    shadow_rs::shadow!(info);
}
pub mod config;
pub mod error;
pub mod files;
pub mod http;
pub mod id;
pub mod idempotency;
pub mod mcp;
pub mod observability;
pub mod pagination;
pub mod runtime;
pub mod services;
pub mod shutdown;
pub mod state;

pub use app::{ServerApplication, ServerBuilder};
pub use banner::{BANNER, Banner};
pub use config::{
    AppConfig, BlobConfig, ConfigOrigin, DatabaseAuth, DatabaseConfig, DatabaseDataDir,
    DatabaseEndpoint, DatabaseEngine, DatabaseName, EnvironmentLayer, FileBackendConfig,
    FilesConfig, HttpConfig, LoadedConfig, LocalFileConfig, LogFormat, McpConfig, Namespace,
    ObjectPrefix, ObservabilityConfig, RuntimeConfig, S3AddressingStyle, S3Credentials,
    S3FileConfig, ServerConfig, StoragePath, TransportSecurity,
};
pub use database::{ConfigError as DatabaseConfigError, Database, Error as DatabaseError, Session};
pub use error::{AppError, AppResult, ConfigError, DbError, FileError, ServerError, ServerResult};
pub use files::id::{FileId, UploadId};
pub use files::list::ListBlobs;
pub use files::meta::{
    BlobChecksum, BlobKey, BlobKind, BlobMedia, BlobName, BlobObservation, BlobRecord, BlobSize,
    ChecksumAlgorithm, ChecksumKind, ChecksumVerifier, DetectedMedia, DetectionConfidence,
    DetectionSource, DetectionState, DetectionStateKind, MediaProfile, MediaRisk, ReadyKey,
    SampleCompleteness, ServingContent, ServingDisposition, ServingPolicy, Sha256Digest,
    StagingKey, StoredBlob, UploadDecision, ValidationNeed, ValidationState,
};
pub use files::service::{BlobService, DownloadAccess, FileService, UploadService};
pub use files::upload::{
    ActorId, ChecksumEncoding, PartNumber, UploadAccess, UploadChecksum, UploadHeader, UploadMode,
    UploadPurpose, UploadSession, UploadState,
};
pub use http::extract::{PageCursor, Pagination};
pub use id::{
    ChunkId, CollectionId, DocumentId, DocumentVersionId, EventId, IngestionId, OperationId, RunId,
    ScheduleId, SourceId,
};
pub use idempotency::{IdempotencyKey, IdempotencyKeyError};
pub use observability::init as init_observability;
pub use pagination::{
    DefaultPagePolicy, Limit, Page, PagePolicy, PagePolicySource, PageQuery, PageRequest,
    PageWindow, Paginated, PaginationError,
};
pub use public_id::{PublicId, PublicIdError, ResourceId, Uuid};
pub use runtime::build_runtime;
pub use services::parser::{ParseSummary, ParserService};
pub use shutdown::{ShutdownCoordinator, ShutdownReason};
pub use state::{AppState, DbState, FileState, ParserState, ReadinessLevel, ReadinessSnapshot};
