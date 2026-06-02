use secrecy::{ExposeSecret, SecretString};
use smol_str::SmolStr;

use super::raw::{RawAppConfig, RawFilesConfig, RawHttpConfig, RawS3Credentials, RawS3FileConfig};
use super::types::{
    AppConfig, FilesConfig, HttpConfig, McpConfig, ObjectPrefix, S3Credentials, S3FileConfig,
};
use crate::error::ConfigError;
use crate::pagination::{Limit, PagePolicy};

impl TryFrom<RawAppConfig> for AppConfig {
    type Error = ConfigError;

    fn try_from(value: RawAppConfig) -> Result<Self, Self::Error> {
        Ok(Self {
            server: value.server,
            runtime: value.runtime,
            observability: value.observability,
            http: HttpConfig::try_from(value.http)?,
            mcp: validate_mcp(value.mcp)?,
            db: value.db,
            files: FilesConfig::try_from(value.files)?,
        })
    }
}

impl TryFrom<RawFilesConfig> for FilesConfig {
    type Error = ConfigError;

    fn try_from(value: RawFilesConfig) -> Result<Self, Self::Error> {
        Ok(Self { storage: S3FileConfig::try_from(value.storage)?, uploads: value.uploads })
    }
}

impl TryFrom<RawS3FileConfig> for S3FileConfig {
    type Error = ConfigError;

    fn try_from(value: RawS3FileConfig) -> Result<Self, Self::Error> {
        if let Some(endpoint) = &value.endpoint {
            value.transport_security.validate_endpoint(endpoint)?;
        }
        Ok(Self {
            bucket: validate_text(value.bucket, "s3 bucket")?,
            region: validate_text(value.region, "s3 region")?,
            endpoint: value.endpoint,
            prefix: value.prefix.map(ObjectPrefix::new).transpose()?,
            addressing_style: value.addressing_style,
            transport_security: value.transport_security,
            credentials: S3Credentials::try_from(value.credentials)?,
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
            pagination: PagePolicy::new(default, max).map_err(|source| {
                ConfigError::invalid("invalid http.pagination configuration").with_source(source)
            })?,
        })
    }
}

impl TryFrom<RawS3Credentials> for S3Credentials {
    type Error = ConfigError;

    fn try_from(value: RawS3Credentials) -> Result<Self, Self::Error> {
        match value {
            RawS3Credentials::Ambient => Ok(Self::Ambient),
            RawS3Credentials::Static { access_key_id, secret_access_key, session_token } => {
                Ok(Self::Static {
                    access_key_id: validate_text(access_key_id, "s3 access key id")?,
                    secret_access_key: validate_secret(secret_access_key, "s3 secret access key")?,
                    session_token: session_token
                        .map(|value| validate_secret(value, "s3 session token"))
                        .transpose()?,
                })
            }
        }
    }
}

fn validate_mcp(value: McpConfig) -> Result<McpConfig, ConfigError> {
    validate_list(&value.allowed_hosts, "mcp.allowed_hosts")?;
    validate_list(&value.allowed_origins, "mcp.allowed_origins")?;
    if value.sse_keep_alive.is_zero() {
        return Err(ConfigError::invalid("mcp.sse_keep_alive must be greater than zero"));
    }
    if value.sse_retry.is_zero() {
        return Err(ConfigError::invalid("mcp.sse_retry must be greater than zero"));
    }
    Ok(value)
}

fn validate_list(values: &[String], kind: &str) -> Result<(), ConfigError> {
    if values.is_empty() {
        return Err(ConfigError::invalid(format!("{kind} must contain at least one value")));
    }
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(ConfigError::invalid(format!("{kind} values cannot be empty")));
    }
    Ok(())
}

fn validate_secret(value: SecretString, kind: &str) -> Result<SecretString, ConfigError> {
    if value.expose_secret().trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(value)
}

fn validate_text(value: String, kind: &str) -> Result<SmolStr, ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(value.into())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn mcp_requires_transport_safeguards() {
        let mut cfg = RawAppConfig::default();
        cfg.mcp.allowed_hosts.clear();
        assert_eq!(
            AppConfig::try_from(cfg).unwrap_err().to_string(),
            "mcp.allowed_hosts must contain at least one value"
        );

        let mut cfg = RawAppConfig::default();
        cfg.mcp.allowed_origins.clear();
        assert_eq!(
            AppConfig::try_from(cfg).unwrap_err().to_string(),
            "mcp.allowed_origins must contain at least one value"
        );

        let mut cfg = RawAppConfig::default();
        cfg.mcp.sse_keep_alive = Duration::ZERO;
        assert_eq!(
            AppConfig::try_from(cfg).unwrap_err().to_string(),
            "mcp.sse_keep_alive must be greater than zero"
        );
    }

    #[test]
    fn files_require_object_storage_coordinates() {
        let cfg = RawAppConfig::default();
        assert_eq!(AppConfig::try_from(cfg).unwrap_err().to_string(), "s3 bucket cannot be empty");

        let mut cfg = RawAppConfig::default();
        cfg.files.storage.bucket = "canary-test".to_owned();
        assert_eq!(AppConfig::try_from(cfg).unwrap_err().to_string(), "s3 region cannot be empty");
    }
}
