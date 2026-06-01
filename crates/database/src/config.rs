use std::fmt;
use std::path::{Path, PathBuf};

use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use smol_str::SmolStr;
use url::Url;

use crate::error::ConfigError;
use crate::raw;

/// Validated runtime database configuration.
///
/// This type accepts the workspace's configuration shape on input, including
/// legacy field names like `ns`, `db`, and `mode`, and exposes a clearer API in
/// code through [`namespace`](Self::namespace), [`database`](Self::database),
/// and [`engine`](Self::engine).
#[derive(Debug, Clone, Deserialize)]
#[serde(default, try_from = "raw::ConfigDef")]
pub struct Config {
    namespace: Namespace,
    database: DatabaseName,
    auth: Auth,
    engine: Engine,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            namespace: Namespace::new("main").expect("default namespace should be valid"),
            database: DatabaseName::new("main").expect("default database should be valid"),
            auth: Auth::None,
            engine: Engine::Memory,
        }
    }
}

impl Config {
    /// Returns the configured namespace.
    #[must_use]
    pub fn namespace(&self) -> &Namespace {
        &self.namespace
    }

    /// Returns the configured database name.
    #[must_use]
    pub fn database(&self) -> &DatabaseName {
        &self.database
    }

    /// Returns the configured authentication strategy.
    #[must_use]
    pub fn auth(&self) -> &Auth {
        &self.auth
    }

    /// Returns the configured engine.
    #[must_use]
    pub fn engine(&self) -> &Engine {
        &self.engine
    }
}

/// The database engine the runtime should connect to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Engine {
    Remote { endpoint: Endpoint },
    Memory,
    RocksDb { dir: DataDir },
    SurrealKv { dir: DataDir },
}

/// Authentication strategy used during connection setup.
#[derive(Debug, Clone)]
pub enum Auth {
    None,
    Root { username: SmolStr, password: SecretString },
    Namespace { username: SmolStr, password: SecretString },
    Database { username: SmolStr, password: SecretString },
}

/// A validated SurrealDB namespace.
#[doc(alias = "ns")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Namespace(SmolStr);

impl Namespace {
    /// Creates a namespace after validating that it is non-empty.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
        let value = value.into();
        validate_name(value.as_str(), "namespace")?;
        Ok(Self(value))
    }

    /// Returns the namespace as a borrowed string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// A validated SurrealDB database name.
#[doc(alias = "db")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseName(SmolStr);

impl DatabaseName {
    /// Creates a database name after validating that it is non-empty.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, ConfigError> {
        let value = value.into();
        validate_name(value.as_str(), "database")?;
        Ok(Self(value))
    }

    /// Returns the database name as a borrowed string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Filesystem location for an embedded database engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDir(PathBuf);

impl DataDir {
    /// Creates a data directory wrapper after checking that the path is not empty.
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, ConfigError> {
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err(ConfigError::invalid("data directory cannot be empty"));
        }
        Ok(Self(path))
    }

    /// Returns the underlying filesystem path.
    #[must_use]
    pub fn as_path(&self) -> &Path {
        self.0.as_path()
    }
}

/// Validated remote SurrealDB endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    Ws(Url),
    Wss(Url),
    Http(Url),
    Https(Url),
}

impl Endpoint {
    /// Parses and validates a remote endpoint URL.
    ///
    /// Supported schemes are `ws`, `wss`, `http`, and `https`.
    pub fn parse(value: &str) -> Result<Self, ConfigError> {
        let url = Url::parse(value).map_err(|source| {
            ConfigError::invalid("invalid surrealdb remote endpoint").with_source(source)
        })?;
        Self::try_from(url)
    }

    /// Returns the endpoint as a borrowed string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Ws(url) | Self::Wss(url) | Self::Http(url) | Self::Https(url) => url.as_str(),
        }
    }
}

impl TryFrom<raw::ConfigDef> for Config {
    type Error = ConfigError;

    fn try_from(value: raw::ConfigDef) -> Result<Self, Self::Error> {
        Ok(Self {
            namespace: Namespace::new(value.namespace)?,
            database: DatabaseName::new(value.database)?,
            auth: Auth::try_from(value.auth)?,
            engine: Engine::try_from(value.engine)?,
        })
    }
}

impl TryFrom<raw::AuthDef> for Auth {
    type Error = ConfigError;

    fn try_from(value: raw::AuthDef) -> Result<Self, Self::Error> {
        match value {
            raw::AuthDef::None => Ok(Self::None),
            raw::AuthDef::Root { username, password } => Ok(Self::Root {
                username: validate_user(username, "root username")?,
                password: validate_secret(password, "root password")?,
            }),
            raw::AuthDef::Namespace { username, password } => Ok(Self::Namespace {
                username: validate_user(username, "namespace username")?,
                password: validate_secret(password, "namespace password")?,
            }),
            raw::AuthDef::Database { username, password } => Ok(Self::Database {
                username: validate_user(username, "database username")?,
                password: validate_secret(password, "database password")?,
            }),
        }
    }
}

impl TryFrom<raw::EngineDef> for Engine {
    type Error = ConfigError;

    fn try_from(value: raw::EngineDef) -> Result<Self, Self::Error> {
        match value {
            raw::EngineDef::Remote { endpoint } => {
                Ok(Self::Remote { endpoint: Endpoint::parse(endpoint.as_str())? })
            }
            raw::EngineDef::Memory => Ok(Self::Memory),
            raw::EngineDef::Rocksdb { path } => Ok(Self::RocksDb { dir: DataDir::new(path)? }),
            raw::EngineDef::Surrealkv { path } => Ok(Self::SurrealKv { dir: DataDir::new(path)? }),
        }
    }
}

impl TryFrom<Url> for Endpoint {
    type Error = ConfigError;

    fn try_from(value: Url) -> Result<Self, Self::Error> {
        match value.scheme() {
            "ws" => Ok(Self::Ws(value)),
            "wss" => Ok(Self::Wss(value)),
            "http" => Ok(Self::Http(value)),
            "https" => Ok(Self::Https(value)),
            scheme => {
                Err(ConfigError::invalid(format!("unsupported surrealdb remote scheme `{scheme}`")))
            }
        }
    }
}

impl TryFrom<String> for Namespace {
    type Error = ConfigError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<String> for DatabaseName {
    type Error = ConfigError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<PathBuf> for DataDir {
    type Error = ConfigError;

    fn try_from(value: PathBuf) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<Namespace> for String {
    fn from(value: Namespace) -> Self {
        value.0.into()
    }
}

impl From<DatabaseName> for String {
    fn from(value: DatabaseName) -> Self {
        value.0.into()
    }
}

impl From<DataDir> for PathBuf {
    fn from(value: DataDir) -> Self {
        value.0
    }
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

fn validate_name(value: &str, kind: &str) -> Result<(), ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(())
}

fn validate_user(value: String, kind: &str) -> Result<SmolStr, ConfigError> {
    if value.trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(value.into())
}

fn validate_secret(value: SecretString, kind: &str) -> Result<SecretString, ConfigError> {
    if value.expose_secret().trim().is_empty() {
        return Err(ConfigError::invalid(format!("{kind} cannot be empty")));
    }
    Ok(value)
}
