use std::time::Duration;

pub(crate) const CONFIG_PATH_ENV: &str = "CANARY_SERVER_CONFIG";
pub(crate) const ENV_PREFIX: &str = "CANARY_SERVER";
pub(crate) const ENV_SEPARATOR: &str = "__";
pub(crate) const DEFAULT_CONFIG_CANDIDATES: &[&str] =
    &["canary-server.toml", "config/canary-server.toml"];
pub(crate) const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const DEFAULT_SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(30);
pub(crate) const DEFAULT_MCP_SSE_KEEP_ALIVE: Duration = Duration::from_secs(15);
pub(crate) const DEFAULT_MCP_SSE_RETRY: Duration = Duration::from_secs(3);
pub(crate) const DEFAULT_THREAD_KEEP_ALIVE: Duration = Duration::from_secs(10);
pub(crate) const DEFAULT_BODY_LIMIT: usize = 8 * 1024 * 1024;
pub(crate) const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;
pub(crate) const DEFAULT_SNIFF_BYTES: usize = 8 * 1024;
pub(crate) const DEFAULT_UPLOAD_INTENT_TTL: Duration = Duration::from_secs(15 * 60);
pub(crate) const DEFAULT_UPLOAD_PRESIGN_TTL: Duration = Duration::from_secs(15 * 60);
pub(crate) const DEFAULT_UPLOAD_MAX_BYTES: u64 = 5 * 1024 * 1024 * 1024;
pub(crate) const DEFAULT_MULTIPART_THRESHOLD: u64 = 100 * 1024 * 1024;
pub(crate) const DEFAULT_MULTIPART_PART_SIZE: u64 = 8 * 1024 * 1024;
pub(crate) const DEFAULT_MULTIPART_MAX_PARTS: u16 = 10_000;
pub(crate) const DEFAULT_PAGE_LIMIT: usize = 100;
pub(crate) const DEFAULT_FILE_ROOT: &str = "data/blobs";
