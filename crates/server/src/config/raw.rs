use std::path::PathBuf;

use secrecy::SecretString;
use serde::Deserialize;
use url::Url;

use super::defaults::{DEFAULT_BODY_LIMIT, DEFAULT_FILE_ROOT, DEFAULT_PAGE_LIMIT};
use super::types::{
    BlobConfig, ObservabilityConfig, RuntimeConfig, S3AddressingStyle, ServerConfig,
    TransportSecurity,
};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(crate) struct RawAppConfig {
    pub(crate) server: ServerConfig,
    pub(crate) runtime: RuntimeConfig,
    pub(crate) observability: ObservabilityConfig,
    pub(crate) http: RawHttpConfig,
    pub(crate) db: RawSurrealConfig,
    pub(crate) files: RawFilesConfig,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(crate) struct RawFilesConfig {
    pub(crate) root: Option<PathBuf>,
    pub(crate) backend: RawFileBackendConfig,
    pub(crate) uploads: BlobConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RawFileBackendConfig {
    Local {
        root: PathBuf,
    },
    S3 {
        #[serde(flatten)]
        cfg: Box<RawS3FileConfig>,
    },
}

impl Default for RawFileBackendConfig {
    fn default() -> Self {
        Self::Local { root: PathBuf::from(DEFAULT_FILE_ROOT) }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(crate) struct RawS3FileConfig {
    pub(crate) bucket: String,
    pub(crate) region: String,
    pub(crate) endpoint: Option<Url>,
    pub(crate) prefix: Option<String>,
    pub(crate) addressing_style: S3AddressingStyle,
    pub(crate) transport_security: TransportSecurity,
    pub(crate) credentials: RawS3Credentials,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RawS3Credentials {
    #[default]
    Ambient,
    Static {
        access_key_id: String,
        secret_access_key: SecretString,
        #[serde(default)]
        session_token: Option<SecretString>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub(crate) struct RawHttpConfig {
    pub(crate) parser_max_bytes: usize,
    pub(crate) pagination: RawPaginationConfig,
}

impl Default for RawHttpConfig {
    fn default() -> Self {
        Self { parser_max_bytes: DEFAULT_BODY_LIMIT, pagination: RawPaginationConfig::default() }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub(crate) struct RawPaginationConfig {
    pub(crate) default_limit: usize,
    pub(crate) max_limit: Option<usize>,
}

impl Default for RawPaginationConfig {
    fn default() -> Self {
        Self { default_limit: DEFAULT_PAGE_LIMIT, max_limit: None }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub(crate) struct RawSurrealConfig {
    pub(crate) ns: String,
    pub(crate) db: String,
    pub(crate) auth: RawSurrealAuth,
    pub(crate) mode: RawSurrealMode,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RawSurrealAuth {
    #[default]
    None,
    Root {
        username: String,
        password: SecretString,
    },
    Namespace {
        username: String,
        password: SecretString,
    },
    Database {
        username: String,
        password: SecretString,
    },
}

#[derive(Debug, Clone, Default, Deserialize)]
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
