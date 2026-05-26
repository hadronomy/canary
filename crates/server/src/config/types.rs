use std::fmt;
use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::thread::available_parallelism;
use std::time::Duration;

use object_store::path::Path as ObjectPath;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use url::Url;

use super::defaults::{
    DEFAULT_BODY_LIMIT, DEFAULT_CHUNK_SIZE, DEFAULT_FILE_ROOT, DEFAULT_MULTIPART_MAX_PARTS,
    DEFAULT_MULTIPART_PART_SIZE, DEFAULT_MULTIPART_THRESHOLD, DEFAULT_PAGE_LIMIT,
    DEFAULT_REQUEST_TIMEOUT, DEFAULT_SHUTDOWN_GRACE_PERIOD, DEFAULT_SNIFF_BYTES,
    DEFAULT_THREAD_KEEP_ALIVE, DEFAULT_UPLOAD_INTENT_TTL, DEFAULT_UPLOAD_MAX_BYTES,
    DEFAULT_UPLOAD_PRESIGN_TTL,
};
use crate::error::ConfigError;
use crate::pagination::{Limit, PagePolicy};

#[derive(Debug, Clone, Default)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub runtime: RuntimeConfig,
    pub observability: ObservabilityConfig,
    pub http: HttpConfig,
    pub db: SurrealConfig,
    pub files: FilesConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    #[serde(with = "humantime_serde")]
    pub request_timeout: Duration,
    #[serde(with = "humantime_serde")]
    pub shutdown_grace_period: Duration,
    pub max_body_size_bytes: usize,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: ([127, 0, 0, 1], 8080).into(),
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
            shutdown_grace_period: DEFAULT_SHUTDOWN_GRACE_PERIOD,
            max_body_size_bytes: DEFAULT_BODY_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct RuntimeConfig {
    pub worker_threads: Option<NonZeroUsize>,
    pub max_blocking_threads: usize,
    pub thread_stack_size_bytes: usize,
    pub event_interval: u32,
    pub global_queue_interval: u32,
    #[serde(with = "humantime_serde")]
    pub thread_keep_alive: Duration,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            worker_threads: None,
            max_blocking_threads: 512,
            thread_stack_size_bytes: 2 * 1024 * 1024,
            event_interval: 61,
            global_queue_interval: 31,
            thread_keep_alive: DEFAULT_THREAD_KEEP_ALIVE,
        }
    }
}

impl RuntimeConfig {
    #[must_use]
    pub fn worker_threads(&self) -> usize {
        self.worker_threads
            .map(NonZeroUsize::get)
            .or_else(|| available_parallelism().ok().map(NonZeroUsize::get))
            .unwrap_or(4)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ObservabilityConfig {
    pub service_name: String,
    pub filter: String,
    pub format: LogFormat,
    pub include_targets: bool,
    pub include_thread_ids: bool,
    pub include_thread_names: bool,
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            service_name: "canary-server".into(),
            filter: "canary_server=debug,tower_http=info,axum=info".into(),
            format: LogFormat::Pretty,
            include_targets: true,
            include_thread_ids: false,
            include_thread_names: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogFormat {
    #[default]
    Pretty,
    Json,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpConfig {
    pub parser_max_bytes: usize,
    pub pagination: PagePolicy,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            parser_max_bytes: DEFAULT_BODY_LIMIT,
            pagination: PagePolicy::unbounded(
                Limit::new(DEFAULT_PAGE_LIMIT).expect("default page limit is valid"),
            ),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SurrealConfig {
    pub ns: Namespace,
    pub db: DatabaseName,
    pub auth: SurrealAuth,
    pub mode: SurrealMode,
}

impl Default for SurrealConfig {
    fn default() -> Self {
        Self {
            ns: Namespace::new("main").expect("default namespace is valid"),
            db: DatabaseName::new("main").expect("default database is valid"),
            auth: SurrealAuth::None,
            mode: SurrealMode::Embedded(EmbeddedSurrealConfig::Memory),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurrealMode {
    Remote(RemoteSurrealConfig),
    Embedded(EmbeddedSurrealConfig),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSurrealConfig {
    pub endpoint: RemoteEndpoint,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbeddedSurrealConfig {
    Memory,
    RocksDb { path: StoragePath },
    SurrealKv { path: StoragePath },
}

#[derive(Debug, Clone)]
pub enum SurrealAuth {
    None,
    Root { username: SmolStr, password: SecretString },
    Namespace { username: SmolStr, password: SecretString },
    Database { username: SmolStr, password: SecretString },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Namespace(SmolStr);

impl Namespace {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
        let value = value.into();
        validate_name(value.as_str(), "namespace")?;
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseName(SmolStr);

impl DatabaseName {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
        let value = value.into();
        validate_name(value.as_str(), "database")?;
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoragePath(PathBuf);

impl StoragePath {
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, ConfigError> {
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err(ConfigError::invalid("storage path cannot be empty"));
        }
        Ok(Self(path))
    }

    #[must_use]
    pub fn as_path(&self) -> &Path {
        self.0.as_path()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectPrefix(SmolStr);

impl ObjectPrefix {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(ConfigError::invalid("object prefix cannot be empty"));
        }
        ObjectPath::parse(value.as_str())
            .map_err(|source| {
                ConfigError::invalid("object prefix must be a valid object-store path")
                    .with_source(source)
            })
            .map(|_| Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteEndpoint {
    Ws(Url),
    Wss(Url),
    Http(Url),
    Https(Url),
}

impl RemoteEndpoint {
    pub fn parse(value: &str) -> Result<Self, ConfigError> {
        let url = Url::parse(value).map_err(|source| {
            ConfigError::invalid("invalid surrealdb remote endpoint").with_source(source)
        })?;
        match url.scheme() {
            "ws" => Ok(Self::Ws(url)),
            "wss" => Ok(Self::Wss(url)),
            "http" => Ok(Self::Http(url)),
            "https" => Ok(Self::Https(url)),
            scheme => {
                Err(ConfigError::invalid(format!("unsupported surrealdb remote scheme `{scheme}`")))
            }
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Ws(url) | Self::Wss(url) | Self::Http(url) | Self::Https(url) => url.as_str(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct FilesConfig {
    pub backend: FileBackendConfig,
    pub uploads: BlobConfig,
}

impl Default for FilesConfig {
    fn default() -> Self {
        let root = StoragePath::new(DEFAULT_FILE_ROOT).expect("default blob root is valid");
        Self {
            backend: FileBackendConfig::Local(LocalFileConfig { root }),
            uploads: BlobConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum FileBackendConfig {
    Local(LocalFileConfig),
    S3(Box<S3FileConfig>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFileConfig {
    pub root: StoragePath,
}

#[derive(Debug, Clone)]
pub struct S3FileConfig {
    pub bucket: SmolStr,
    pub region: SmolStr,
    pub endpoint: Option<Url>,
    pub prefix: Option<ObjectPrefix>,
    pub addressing_style: S3AddressingStyle,
    pub transport_security: TransportSecurity,
    pub credentials: S3Credentials,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum S3AddressingStyle {
    #[default]
    VirtualHosted,
    PathStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportSecurity {
    #[default]
    HttpsOnly,
    AllowHttp,
}

impl TransportSecurity {
    pub fn validate_endpoint(self, endpoint: &Url) -> Result<(), ConfigError> {
        if matches!(self, Self::HttpsOnly) && endpoint.scheme() == "http" {
            return Err(ConfigError::invalid(
                "http s3 endpoints require transport_security = allow_http",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum S3Credentials {
    Ambient,
    Static {
        access_key_id: SmolStr,
        secret_access_key: SecretString,
        session_token: Option<SecretString>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BlobConfig {
    pub chunk_size_bytes: usize,
    pub sniff_bytes: usize,
    pub max_bytes: u64,
    pub multipart_threshold_bytes: u64,
    pub multipart_part_size_bytes: u64,
    pub multipart_max_parts: u16,
    #[serde(with = "humantime_serde")]
    pub intent_ttl: Duration,
    #[serde(with = "humantime_serde")]
    pub presign_ttl: Duration,
}

impl Default for BlobConfig {
    fn default() -> Self {
        Self {
            chunk_size_bytes: DEFAULT_CHUNK_SIZE,
            sniff_bytes: DEFAULT_SNIFF_BYTES,
            max_bytes: DEFAULT_UPLOAD_MAX_BYTES,
            multipart_threshold_bytes: DEFAULT_MULTIPART_THRESHOLD,
            multipart_part_size_bytes: DEFAULT_MULTIPART_PART_SIZE,
            multipart_max_parts: DEFAULT_MULTIPART_MAX_PARTS,
            intent_ttl: DEFAULT_UPLOAD_INTENT_TTL,
            presign_ttl: DEFAULT_UPLOAD_PRESIGN_TTL,
        }
    }
}

fn validate_name(value: &str, kind: &str) -> Result<(), ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    if !value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')) {
        return Err(ConfigError::invalid(format!(
            "{kind} may only contain ASCII letters, digits, '-', '_' and '.'"
        )));
    }
    Ok(())
}

impl fmt::Display for Namespace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Display for DatabaseName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
