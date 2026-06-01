use std::borrow::Cow;

use miette::Diagnostic;
use thiserror::Error;

type Source = Box<dyn std::error::Error + Send + Sync + 'static>;

#[derive(Debug, Error, Diagnostic)]
pub enum ConfigError {
    #[error("{message}")]
    #[diagnostic(
        code(database::config::invalid),
        help("Review the database configuration and correct the invalid value.")
    )]
    Invalid {
        message: Cow<'static, str>,
        #[source]
        source: Option<Source>,
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
        let Self::Invalid { source: inner, .. } = &mut self;
        *inner = Some(Box::new(source));
        self
    }
}

#[derive(Debug, Error, Diagnostic)]
pub enum Error {
    #[error(transparent)]
    #[diagnostic(transparent)]
    Config(#[from] ConfigError),
    #[error("database engine is not compiled in: {message}")]
    #[diagnostic(
        code(database::engine::unsupported),
        help("Enable the matching database crate feature for the configured engine.")
    )]
    UnsupportedEngine { message: Cow<'static, str> },
    #[error("failed to connect to surrealdb")]
    #[diagnostic(code(database::connect))]
    Connect {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to authenticate against surrealdb")]
    #[diagnostic(code(database::authenticate))]
    Authenticate {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to select surrealdb namespace/database")]
    #[diagnostic(code(database::select_context))]
    SelectContext {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("surrealdb health check failed")]
    #[diagnostic(code(database::health))]
    Health {
        #[source]
        source: Box<surrealdb::Error>,
    },
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
