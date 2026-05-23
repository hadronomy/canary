use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::thread::available_parallelism;
use std::time::Duration;
use std::{env, fmt};

use config as config_rs;
use config_rs::{Config, Environment, File, FileFormat};
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use url::Url;

use crate::error::ConfigError;
use crate::pagination::{Limit, PagePolicy};

const CONFIG_PATH_ENV: &str = "CANARY_SERVER_CONFIG";
const ENV_PREFIX: &str = "CANARY_SERVER";
const ENV_SEPARATOR: &str = "__";
const DEFAULT_CONFIG_CANDIDATES: &[&str] = &["canary-server.toml", "config/canary-server.toml"];
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(30);
const DEFAULT_THREAD_KEEP_ALIVE: Duration = Duration::from_secs(10);
const DEFAULT_BODY_LIMIT: usize = 8 * 1024 * 1024;
const DEFAULT_RAW_UPLOAD_LIMIT: u64 = 64 * 1024 * 1024;
const DEFAULT_MULTIPART_LIMIT: usize = 64 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;
const DEFAULT_SNIFF_BYTES: usize = 8 * 1024;
const DEFAULT_PAGE_LIMIT: usize = 100;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LoadedConfig {
    pub settings: AppConfig,
    pub origin: ConfigOrigin,
}

impl LoadedConfig {
    pub fn load() -> Result<Self, ConfigError> {
        let origin = ConfigOrigin::discover()?;
        let settings = build_settings(&origin.files, None)?;
        Ok(Self { settings, origin })
    }

    #[doc(hidden)]
    pub fn load_from_environment_map(
        overrides: HashMap<String, String>,
    ) -> Result<Self, ConfigError> {
        let origin = ConfigOrigin {
            files: config_files(None)?,
            includes_environment: !overrides.is_empty(),
        };
        let settings = build_settings(&origin.files, Some(overrides))?;
        Ok(Self { settings, origin })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigOrigin {
    pub files: Vec<PathBuf>,
    pub includes_environment: bool,
}

impl ConfigOrigin {
    fn discover() -> Result<Self, ConfigError> {
        let explicit = env::var_os(CONFIG_PATH_ENV).map(PathBuf::from);
        Ok(Self {
            files: config_files(explicit)?,
            includes_environment: env::vars_os()
                .filter_map(|(key, _)| key.into_string().ok())
                .any(|key| key.starts_with(ENV_PREFIX)),
        })
    }
}

impl fmt::Display for ConfigOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.files.as_slice(), self.includes_environment) {
            ([], true) => f.write_str("defaults + environment"),
            ([], false) => f.write_str("defaults"),
            ([file], true) => write!(f, "{} + environment", file.display()),
            ([file], false) => write!(f, "{}", file.display()),
            (files, includes_environment) => {
                let joined = files
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                if includes_environment {
                    write!(f, "{joined} + environment")
                } else {
                    f.write_str(&joined)
                }
            }
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
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
    pub raw_upload_max_bytes: u64,
    pub multipart_max_bytes: usize,
    pub pagination: PagePolicy,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            parser_max_bytes: DEFAULT_BODY_LIMIT,
            raw_upload_max_bytes: DEFAULT_RAW_UPLOAD_LIMIT,
            multipart_max_bytes: DEFAULT_MULTIPART_LIMIT,
            pagination: PagePolicy::unbounded(
                Limit::new(DEFAULT_PAGE_LIMIT).expect("default page limit is valid"),
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SurrealAuth {
    None,
    Root { username: SmolStr, password: Secret },
    Namespace { username: SmolStr, password: Secret },
    Database { username: SmolStr, password: Secret },
}

#[derive(Clone, PartialEq, Eq)]
pub struct Secret(SmolStr);

impl Secret {
    #[must_use]
    pub fn reveal(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(**redacted**)")
    }
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilesConfig {
    pub root: StoragePath,
    pub uploads: BlobConfig,
}

impl Default for FilesConfig {
    fn default() -> Self {
        Self {
            root: StoragePath::new("data/blobs").expect("default blob root is valid"),
            uploads: BlobConfig::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BlobConfig {
    pub chunk_size_bytes: usize,
    pub sniff_bytes: usize,
}

impl Default for BlobConfig {
    fn default() -> Self {
        Self { chunk_size_bytes: DEFAULT_CHUNK_SIZE, sniff_bytes: DEFAULT_SNIFF_BYTES }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct RawAppConfig {
    server: ServerConfig,
    runtime: RuntimeConfig,
    observability: ObservabilityConfig,
    http: RawHttpConfig,
    db: RawSurrealConfig,
    files: RawFilesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct RawFilesConfig {
    root: PathBuf,
    uploads: BlobConfig,
}

impl Default for RawFilesConfig {
    fn default() -> Self {
        Self { root: PathBuf::from("data/blobs"), uploads: BlobConfig::default() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct RawHttpConfig {
    parser_max_bytes: usize,
    raw_upload_max_bytes: u64,
    multipart_max_bytes: usize,
    pagination: RawPaginationConfig,
}

impl Default for RawHttpConfig {
    fn default() -> Self {
        Self {
            parser_max_bytes: DEFAULT_BODY_LIMIT,
            raw_upload_max_bytes: DEFAULT_RAW_UPLOAD_LIMIT,
            multipart_max_bytes: DEFAULT_MULTIPART_LIMIT,
            pagination: RawPaginationConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct RawPaginationConfig {
    default_limit: usize,
    max_limit: Option<usize>,
}

impl Default for RawPaginationConfig {
    fn default() -> Self {
        Self { default_limit: DEFAULT_PAGE_LIMIT, max_limit: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RawSurrealConfig {
    ns: String,
    db: String,
    auth: RawSurrealAuth,
    mode: RawSurrealMode,
}

impl Default for RawSurrealConfig {
    fn default() -> Self {
        Self {
            ns: "main".into(),
            db: "main".into(),
            auth: RawSurrealAuth::None,
            mode: RawSurrealMode::Memory,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RawSurrealAuth {
    #[default]
    None,
    Root {
        username: String,
        password: String,
    },
    Namespace {
        username: String,
        password: String,
    },
    Database {
        username: String,
        password: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RawSurrealMode {
    Remote {
        endpoint: String,
    },
    #[default]
    Memory,
    Rocksdb {
        path: PathBuf,
    },
    Surrealkv {
        path: PathBuf,
    },
}

fn build_settings(
    files: &[PathBuf],
    overrides: Option<HashMap<String, String>>,
) -> Result<AppConfig, ConfigError> {
    let defaults = toml::to_string(&RawAppConfig::default())
        .map_err(|source| ConfigError::SerializeDefaults { source })?;

    let mut builder = Config::builder().add_source(File::from_str(&defaults, FileFormat::Toml));

    for path in files {
        builder = builder.add_source(File::from(path.clone()));
    }

    builder = builder.add_source(
        Environment::with_prefix(ENV_PREFIX).separator(ENV_SEPARATOR).try_parsing(true),
    );

    if let Some(overrides) = overrides {
        for (key, value) in overrides {
            builder =
                builder.set_override(key, value).map_err(|source| ConfigError::Build { source })?;
        }
    }

    let built = builder.build().map_err(|source| ConfigError::Build { source })?;
    let raw = built
        .try_deserialize::<RawAppConfig>()
        .map_err(|source| ConfigError::Deserialize { source })?;
    AppConfig::try_from(raw)
}

fn config_files(explicit: Option<PathBuf>) -> Result<Vec<PathBuf>, ConfigError> {
    if let Some(path) = explicit {
        if !path.exists() {
            return Err(ConfigError::MissingExplicitPath { key: CONFIG_PATH_ENV, path });
        }
        return Ok(vec![path]);
    }

    Ok(DEFAULT_CONFIG_CANDIDATES.iter().map(PathBuf::from).filter(|path| path.exists()).collect())
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

impl TryFrom<RawAppConfig> for AppConfig {
    type Error = ConfigError;

    fn try_from(value: RawAppConfig) -> Result<Self, Self::Error> {
        Ok(Self {
            server: value.server,
            runtime: value.runtime,
            observability: value.observability,
            http: HttpConfig::try_from(value.http)?,
            db: SurrealConfig::try_from(value.db)?,
            files: FilesConfig {
                root: StoragePath::new(value.files.root)?,
                uploads: value.files.uploads,
            },
        })
    }
}

impl TryFrom<RawHttpConfig> for HttpConfig {
    type Error = ConfigError;

    fn try_from(value: RawHttpConfig) -> Result<Self, Self::Error> {
        let default = Limit::new(value.pagination.default_limit).map_err(|source| {
            ConfigError::invalid("http.pagination.default_limit must be greater than zero")
                .with_source(source)
        })?;
        let max = value
            .pagination
            .max_limit
            .map(|value| {
                Limit::new(value).map_err(|source| {
                    ConfigError::invalid("http.pagination.max_limit must be greater than zero")
                        .with_source(source)
                })
            })
            .transpose()?;

        Ok(Self {
            parser_max_bytes: value.parser_max_bytes,
            raw_upload_max_bytes: value.raw_upload_max_bytes,
            multipart_max_bytes: value.multipart_max_bytes,
            pagination: PagePolicy::new(default, max).map_err(|source| {
                ConfigError::invalid("invalid http.pagination configuration").with_source(source)
            })?,
        })
    }
}

impl TryFrom<RawSurrealConfig> for SurrealConfig {
    type Error = ConfigError;

    fn try_from(value: RawSurrealConfig) -> Result<Self, Self::Error> {
        Ok(Self {
            ns: Namespace::new(value.ns)?,
            db: DatabaseName::new(value.db)?,
            auth: SurrealAuth::try_from(value.auth)?,
            mode: SurrealMode::try_from(value.mode)?,
        })
    }
}

impl TryFrom<RawSurrealAuth> for SurrealAuth {
    type Error = ConfigError;

    fn try_from(value: RawSurrealAuth) -> Result<Self, Self::Error> {
        match value {
            RawSurrealAuth::None => Ok(Self::None),
            RawSurrealAuth::Root { username, password } => Ok(Self::Root {
                username: validate_auth_value(username, "root username")?,
                password: Secret(validate_auth_value(password, "root password")?),
            }),
            RawSurrealAuth::Namespace { username, password } => Ok(Self::Namespace {
                username: validate_auth_value(username, "namespace username")?,
                password: Secret(validate_auth_value(password, "namespace password")?),
            }),
            RawSurrealAuth::Database { username, password } => Ok(Self::Database {
                username: validate_auth_value(username, "database username")?,
                password: Secret(validate_auth_value(password, "database password")?),
            }),
        }
    }
}

impl TryFrom<RawSurrealMode> for SurrealMode {
    type Error = ConfigError;

    fn try_from(value: RawSurrealMode) -> Result<Self, Self::Error> {
        match value {
            RawSurrealMode::Remote { endpoint } => Ok(Self::Remote(RemoteSurrealConfig {
                endpoint: RemoteEndpoint::parse(&endpoint)?,
            })),
            RawSurrealMode::Memory => Ok(Self::Embedded(EmbeddedSurrealConfig::Memory)),
            RawSurrealMode::Rocksdb { path } => {
                Ok(Self::Embedded(EmbeddedSurrealConfig::RocksDb { path: StoragePath::new(path)? }))
            }
            RawSurrealMode::Surrealkv { path } => {
                Ok(Self::Embedded(EmbeddedSurrealConfig::SurrealKv {
                    path: StoragePath::new(path)?,
                }))
            }
        }
    }
}

fn validate_auth_value(value: String, kind: &str) -> Result<SmolStr, ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(SmolStr::from(value))
}
