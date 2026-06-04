use thiserror::Error;

use crate::{BearerTokenError, ScopeSet};

/// Errors raised while building authorization configuration.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// A configuration value failed semantic validation.
    #[error("{0}")]
    Invalid(String),
    /// A lower-level parser or validator rejected a value.
    #[error(transparent)]
    Source(#[from] Box<dyn std::error::Error + Send + Sync + 'static>),
}

impl ConfigError {
    /// Creates an invalid-configuration error.
    #[must_use]
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }

    /// Wraps a source error.
    pub fn source<E>(source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Source(Box::new(source))
    }
}

/// Errors returned while verifying tokens or evaluating authorization.
#[derive(Debug, Error)]
pub enum AuthError {
    /// Verification was attempted while authorization is disabled.
    #[error("authorization is disabled")]
    Disabled,
    /// The request did not contain a usable bearer token.
    #[error(transparent)]
    Bearer(#[from] BearerTokenError),
    /// A bearer token was supplied through the query string.
    #[error("query-string bearer tokens are not accepted")]
    QueryToken,
    /// The token failed JWT or claims validation.
    #[error("invalid access token")]
    InvalidToken {
        /// Lower-level validation error, when available.
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync + 'static>>,
    },
    /// The principal has a valid token but not enough permission.
    #[error("insufficient scope")]
    InsufficientScope {
        /// Scopes that would satisfy the authorization check.
        required: ScopeSet,
    },
    /// The authorization server metadata, JWKS, or introspection endpoint could not be read.
    #[error("failed to contact authorization server")]
    Fetch {
        /// Lower-level HTTP, OAuth, or decode error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    },
    /// Authorization configuration is invalid.
    #[error(transparent)]
    Config(#[from] ConfigError),
}

impl AuthError {
    /// Creates an invalid-token error from a source.
    #[must_use]
    pub fn invalid_token<E>(source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::InvalidToken { source: Some(Box::new(source)) }
    }

    /// Creates an invalid-token error without exposing parser details.
    #[must_use]
    #[inline(always)]
    pub fn invalid() -> Self {
        Self::InvalidToken { source: None }
    }

    /// Creates an authorization-server fetch error.
    #[must_use]
    pub fn fetch<E>(source: E) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Fetch { source: Box::new(source) }
    }
}
