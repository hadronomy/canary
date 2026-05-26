use secrecy::{ExposeSecret, SecretString};
use smol_str::SmolStr;

use super::raw::{
    RawAppConfig, RawFileBackendConfig, RawFilesConfig, RawHttpConfig, RawS3Credentials,
    RawS3FileConfig, RawSurrealAuth, RawSurrealConfig, RawSurrealMode,
};
use super::types::{
    AppConfig, DatabaseName, EmbeddedSurrealConfig, FileBackendConfig, FilesConfig, HttpConfig,
    LocalFileConfig, Namespace, ObjectPrefix, RemoteEndpoint, RemoteSurrealConfig, S3Credentials,
    S3FileConfig, StoragePath, SurrealAuth, SurrealConfig, SurrealMode,
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
            db: SurrealConfig::try_from(value.db)?,
            files: FilesConfig::try_from(value.files)?,
        })
    }
}

impl TryFrom<RawFilesConfig> for FilesConfig {
    type Error = ConfigError;

    fn try_from(value: RawFilesConfig) -> Result<Self, Self::Error> {
        let backend = match value.backend {
            RawFileBackendConfig::Local { root } => {
                let root = StoragePath::new(value.root.unwrap_or(root))?;
                FileBackendConfig::Local(LocalFileConfig { root })
            }
            RawFileBackendConfig::S3 { cfg } => {
                let RawS3FileConfig {
                    bucket,
                    region,
                    endpoint,
                    prefix,
                    addressing_style,
                    transport_security,
                    credentials,
                } = *cfg;
                if value.root.is_some() {
                    return Err(ConfigError::invalid(
                        "files.root is only valid with the local file backend",
                    ));
                }
                if let Some(endpoint) = &endpoint {
                    transport_security.validate_endpoint(endpoint)?;
                }
                FileBackendConfig::S3(Box::new(S3FileConfig {
                    bucket: validate_text(bucket, "s3 bucket")?,
                    region: validate_text(region, "s3 region")?,
                    endpoint,
                    prefix: prefix.map(ObjectPrefix::new).transpose()?,
                    addressing_style,
                    transport_security,
                    credentials: S3Credentials::try_from(credentials)?,
                }))
            }
        };

        Ok(Self { backend, uploads: value.uploads })
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
                password: validate_secret(password, "root password")?,
            }),
            RawSurrealAuth::Namespace { username, password } => Ok(Self::Namespace {
                username: validate_auth_value(username, "namespace username")?,
                password: validate_secret(password, "namespace password")?,
            }),
            RawSurrealAuth::Database { username, password } => Ok(Self::Database {
                username: validate_auth_value(username, "database username")?,
                password: validate_secret(password, "database password")?,
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

fn validate_auth_value(value: String, kind: &str) -> Result<SmolStr, ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(SmolStr::from(value))
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
