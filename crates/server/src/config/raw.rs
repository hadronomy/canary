use secrecy::SecretString;
use serde::Deserialize;
use url::Url;

use super::defaults::{DEFAULT_BODY_LIMIT, DEFAULT_PAGE_LIMIT};
use super::types::{
    BlobConfig, McpConfig, ObservabilityConfig, RuntimeConfig, S3AddressingStyle, ServerConfig,
    TransportSecurity,
};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(crate) struct RawAppConfig {
    pub(crate) server: ServerConfig,
    pub(crate) runtime: RuntimeConfig,
    pub(crate) observability: ObservabilityConfig,
    pub(crate) http: RawHttpConfig,
    pub(crate) mcp: McpConfig,
    pub(crate) db: database::Config,
    pub(crate) files: RawFilesConfig,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct RawFilesConfig {
    pub(crate) storage: RawS3FileConfig,
    pub(crate) uploads: BlobConfig,
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
