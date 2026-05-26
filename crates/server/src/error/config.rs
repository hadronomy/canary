use std::borrow::Cow;
use std::path::PathBuf;

use miette::Diagnostic;
use thiserror::Error;

use super::SourceError;

#[derive(Debug, Error, Diagnostic)]
pub enum ConfigError {
    #[error("configuration file specified by {key} does not exist: {path}")]
    #[diagnostic(
        code(canary_server::config::missing_explicit_path),
        help("Set CANARY_SERVER_CONFIG to a readable configuration file path.")
    )]
    MissingExplicitPath { key: &'static str, path: PathBuf },
    #[error("{message}")]
    #[diagnostic(
        code(canary_server::config::invalid),
        help("Review the server configuration and correct the invalid value.")
    )]
    Invalid {
        message: Cow<'static, str>,
        #[source]
        source: Option<SourceError>,
    },
    #[error("failed to build layered configuration")]
    #[diagnostic(code(canary_server::config::build))]
    Build {
        #[source]
        source: config::ConfigError,
    },
    #[error("failed to deserialize layered configuration")]
    #[diagnostic(code(canary_server::config::deserialize))]
    Deserialize {
        #[source]
        source: config::ConfigError,
    },
}

impl ConfigError {
    #[must_use]
    pub fn invalid(message: impl Into<Cow<'static, str>>) -> Self {
        Self::Invalid { message: message.into(), source: None }
    }

    #[must_use]
    pub fn with_source<E>(mut self, source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        if let Self::Invalid { source: inner, .. } = &mut self {
            *inner = Some(Box::new(source));
        }
        self
    }
}
