use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::thread::available_parallelism;
use std::time::Duration;

use canary_report::{Doc, Field, Record, Report, Value};
use object_store::path::Path as ObjectPath;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use url::Url;

use super::defaults::{
    DEFAULT_BODY_LIMIT, DEFAULT_MCP_SSE_KEEP_ALIVE, DEFAULT_MCP_SSE_RETRY,
    DEFAULT_MULTIPART_MAX_PARTS, DEFAULT_MULTIPART_PART_SIZE, DEFAULT_MULTIPART_THRESHOLD,
    DEFAULT_PAGE_LIMIT, DEFAULT_REQUEST_TIMEOUT, DEFAULT_SHUTDOWN_GRACE_PERIOD,
    DEFAULT_SNIFF_BYTES, DEFAULT_THREAD_KEEP_ALIVE, DEFAULT_UPLOAD_INTENT_TTL,
    DEFAULT_UPLOAD_MAX_BYTES, DEFAULT_UPLOAD_PRESIGN_TTL,
};
use crate::error::ConfigError;
use crate::pagination::{Limit, PagePolicy};

#[derive(Debug, Clone, Default)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub runtime: RuntimeConfig,
    pub observability: ObservabilityConfig,
    pub auth: canary_authorization::Config,
    pub http: HttpConfig,
    pub mcp: McpConfig,
    pub db: database::Config,
    pub files: FilesConfig,
    pub workers: canary_workers::WorkerConfig,
}

impl Report for AppConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .extend(&self.server)
            .extend(&self.auth)
            .extend(&self.files)
            .extend(&self.db)
            .extend(&self.http)
            .extend(&self.mcp)
            .extend(&self.workers)
            .extend(&self.observability)
            .extend(&self.runtime)
            .build()
    }
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

impl Report for ServerConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("server", "Server")
            .field("listener", "listener", format!("http://{}", self.bind))
            .field("request_timeout", "request timeout", Value::duration(self.request_timeout))
            .field(
                "shutdown_grace_period",
                "shutdown grace",
                Value::duration(self.shutdown_grace_period),
            )
            .field("max_body_size_bytes", "max body", Value::bytes(self.max_body_size_bytes as u64))
            .build()
    }
}

/// Streamable HTTP settings for the MCP endpoint.
///
/// Missing `Origin` headers are accepted because desktop MCP clients usually
/// do not run in a browser. When a browser sends an `Origin`, it must match one
/// of [`Self::allowed_origins`]. Public deployments should replace the local
/// defaults with externally reachable hostnames and trusted browser origins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct McpConfig {
    /// Host authorities accepted by the MCP transport.
    pub allowed_hosts: Vec<String>,

    /// Browser origins accepted when an MCP request carries an `Origin` header.
    pub allowed_origins: Vec<String>,

    /// Interval between SSE keep-alive events.
    #[serde(with = "humantime_serde")]
    pub sse_keep_alive: Duration,

    /// Delay clients should observe before reconnecting an interrupted SSE stream.
    #[serde(with = "humantime_serde")]
    pub sse_retry: Duration,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            allowed_hosts: vec!["localhost".into(), "127.0.0.1".into(), "::1".into()],
            allowed_origins: vec![
                "http://localhost".into(),
                "http://127.0.0.1".into(),
                "http://[::1]".into(),
            ],
            sse_keep_alive: DEFAULT_MCP_SSE_KEEP_ALIVE,
            sse_retry: DEFAULT_MCP_SSE_RETRY,
        }
    }
}

impl Report for McpConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("mcp", "MCP")
            .field("allowed_hosts", "allowed hosts", strings(&self.allowed_hosts))
            .field("allowed_origins", "allowed origins", strings(&self.allowed_origins))
            .field("sse_keep_alive", "sse keep alive", Value::duration(self.sse_keep_alive))
            .field("sse_retry", "sse retry", Value::duration(self.sse_retry))
            .build()
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

impl Report for RuntimeConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("runtime", "Runtime")
            .field("worker_threads", "worker threads", self.worker_threads.map(NonZeroUsize::get))
            .field("resolved_worker_threads", "resolved worker threads", self.worker_threads())
            .field("max_blocking_threads", "max blocking threads", self.max_blocking_threads)
            .field(
                "thread_stack_size_bytes",
                "thread stack",
                Value::bytes(self.thread_stack_size_bytes as u64),
            )
            .field("event_interval", "event interval", u64::from(self.event_interval))
            .field(
                "global_queue_interval",
                "global queue interval",
                u64::from(self.global_queue_interval),
            )
            .field(
                "thread_keep_alive",
                "thread keep alive",
                Value::duration(self.thread_keep_alive),
            )
            .build()
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

impl Report for ObservabilityConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("observability", "Observability")
            .field("service_name", "service", self.service_name.clone())
            .field("filter", "filter", self.filter.clone())
            .field("format", "format", self.format.as_str())
            .field("include_targets", "targets", self.include_targets)
            .field("include_thread_ids", "thread ids", self.include_thread_ids)
            .field("include_thread_names", "thread names", self.include_thread_names)
            .build()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogFormat {
    #[default]
    Pretty,
    Json,
}

impl LogFormat {
    /// Returns the config spelling for this log output format.
    #[inline(always)]
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pretty => "pretty",
            Self::Json => "json",
        }
    }
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

impl Report for HttpConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("http", "HTTP")
            .field("parser_max_bytes", "parser max", Value::bytes(self.parser_max_bytes as u64))
            .field(
                "default_page_limit",
                "default page limit",
                self.pagination.default_limit().get(),
            )
            .field("max_page_limit", "max page limit", self.pagination.max_limit().map(Limit::get))
            .build()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
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
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// File-service settings for S3-compatible object storage.
///
/// File uploads always use [`Self::storage`]. Canary does not provide a local
/// filesystem fallback.
#[derive(Debug, Clone, Default)]
pub struct FilesConfig {
    /// S3-compatible storage used for staged and ready objects.
    pub storage: S3FileConfig,

    /// Upload limits, expiry windows, and multipart policy.
    pub uploads: BlobConfig,
}

impl Report for FilesConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("files", "Storage")
            .field("backend", "backend", "S3-compatible object storage")
            .field("bucket", "bucket", self.storage.bucket.to_string())
            .field("region", "region", self.storage.region.to_string())
            .field("endpoint", "endpoint", self.storage.endpoint.as_ref().map(Url::to_string))
            .field(
                "prefix",
                "prefix",
                self.storage.prefix.as_ref().map(|prefix| prefix.as_str().to_owned()),
            )
            .field("addressing_style", "addressing", addressing(self.storage.addressing_style))
            .field("transport_security", "transport", transport(self.storage.transport_security))
            .field("credentials", "credentials", self.storage.credentials.report_record())
            .field("sniff_bytes", "sniff bytes", Value::bytes(self.uploads.sniff_bytes as u64))
            .field("max_bytes", "max upload", Value::bytes(self.uploads.max_bytes))
            .field(
                "multipart_threshold_bytes",
                "multipart threshold",
                Value::bytes(self.uploads.multipart_threshold_bytes),
            )
            .field(
                "multipart_part_size_bytes",
                "multipart part",
                Value::bytes(self.uploads.multipart_part_size_bytes),
            )
            .field("multipart_max_parts", "multipart max parts", self.uploads.multipart_max_parts)
            .field("intent_ttl", "intent ttl", Value::duration(self.uploads.intent_ttl))
            .field("presign_ttl", "presign ttl", Value::duration(self.uploads.presign_ttl))
            .build()
    }
}

/// Connection settings for the S3-compatible object store used by files.
#[derive(Debug, Clone, Default)]
pub struct S3FileConfig {
    /// Bucket that owns staged and ready objects.
    pub bucket: SmolStr,

    /// AWS-compatible region used for signing and storage requests.
    pub region: SmolStr,

    /// Optional custom endpoint for services such as RustFS, R2, or MinIO.
    pub endpoint: Option<Url>,

    /// Optional key prefix reserved for Canary objects.
    pub prefix: Option<ObjectPrefix>,

    /// Whether requests use virtual-hosted or path-style bucket addressing.
    pub addressing_style: S3AddressingStyle,

    /// Whether a custom endpoint may use plain HTTP.
    pub transport_security: TransportSecurity,

    /// Credentials used for storage requests and presigning.
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

#[derive(Debug, Clone, Default)]
pub enum S3Credentials {
    #[default]
    Ambient,
    Static {
        access_key_id: SmolStr,
        secret_access_key: SecretString,
        session_token: Option<SecretString>,
    },
}

impl S3Credentials {
    fn report_record(&self) -> Record {
        match self {
            Self::Ambient => {
                Record::new().summary("ambient").field(Field::new("kind", "kind", "ambient"))
            }
            Self::Static { session_token, .. } => Record::new()
                .summary(if session_token.is_some() {
                    "static, session token redacted"
                } else {
                    "static, redacted"
                })
                .field(Field::new("kind", "kind", "static"))
                .field(Field::new("access_key_id", "access key id", Value::Redacted))
                .field(Field::new("secret_access_key", "secret access key", Value::Redacted))
                .field(Field::new(
                    "session_token",
                    "session token",
                    if session_token.is_some() { Value::Redacted } else { Value::Null },
                )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BlobConfig {
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

#[inline(always)]
fn strings(values: &[String]) -> Vec<Value> {
    values.iter().map(Value::from).collect()
}

#[inline(always)]
fn addressing(value: S3AddressingStyle) -> &'static str {
    match value {
        S3AddressingStyle::VirtualHosted => "virtual_hosted",
        S3AddressingStyle::PathStyle => "path_style",
    }
}

#[inline(always)]
fn transport(value: TransportSecurity) -> &'static str {
    match value {
        TransportSecurity::HttpsOnly => "https_only",
        TransportSecurity::AllowHttp => "allow_http",
    }
}
