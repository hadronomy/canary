use std::fmt;

use http::HeaderValue;
use thiserror::Error;

use crate::{ResourceUri, ScopeSet};

/// OAuth bearer challenge category rendered in `WWW-Authenticate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeKind {
    /// No token was supplied or the header was malformed.
    Missing,
    /// The token was present but invalid.
    InvalidToken,
    /// The token was valid but did not grant enough scope.
    InsufficientScope,
}

/// RFC 6750 bearer challenge returned with authorization failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Challenge {
    kind: ChallengeKind,
    realm: Option<String>,
    description: Option<String>,
    scope: Option<ScopeSet>,
    resource_metadata: Option<ResourceUri>,
}

impl Challenge {
    /// Creates a challenge for a missing or malformed bearer token.
    #[must_use]
    pub fn missing(resource_metadata: Option<ResourceUri>) -> Self {
        Self {
            kind: ChallengeKind::Missing,
            realm: None,
            description: Some("Bearer token required.".to_owned()),
            scope: None,
            resource_metadata,
        }
    }

    /// Creates a challenge for an invalid token.
    #[must_use]
    pub fn invalid_token(resource_metadata: Option<ResourceUri>) -> Self {
        Self {
            kind: ChallengeKind::InvalidToken,
            realm: None,
            description: Some("The access token is invalid.".to_owned()),
            scope: None,
            resource_metadata,
        }
    }

    /// Creates a challenge for a valid token with insufficient scope.
    #[must_use]
    pub fn insufficient_scope(scope: ScopeSet, resource_metadata: Option<ResourceUri>) -> Self {
        Self {
            kind: ChallengeKind::InsufficientScope,
            realm: None,
            description: Some("The access token does not grant enough scope.".to_owned()),
            scope: Some(scope),
            resource_metadata,
        }
    }

    /// Adds a realm parameter.
    #[must_use]
    pub fn with_realm(mut self, realm: impl Into<String>) -> Self {
        self.realm = Some(realm.into());
        self
    }

    /// Returns the challenge category.
    #[must_use]
    #[inline(always)]
    pub fn kind(&self) -> ChallengeKind {
        self.kind
    }

    /// Renders the challenge as an HTTP header value.
    ///
    /// # Errors
    ///
    /// Returns [`ChallengeError`] when a challenge value cannot be represented
    /// as an HTTP header.
    pub fn to_header_value(&self) -> Result<HeaderValue, ChallengeError> {
        HeaderValue::from_str(&self.to_string()).map_err(ChallengeError::Header)
    }
}

impl fmt::Display for Challenge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Bearer")?;
        let mut params = Vec::new();
        if let Some(realm) = &self.realm {
            params.push(("realm", realm.clone()));
        }
        match self.kind {
            ChallengeKind::Missing => {}
            ChallengeKind::InvalidToken => {
                params.push(("error", "invalid_token".to_owned()));
            }
            ChallengeKind::InsufficientScope => {
                params.push(("error", "insufficient_scope".to_owned()));
            }
        }
        if let Some(description) = &self.description {
            params.push(("error_description", description.clone()));
        }
        if let Some(scope) = &self.scope {
            params.push(("scope", scope.iter().collect::<Vec<_>>().join(" ")));
        }
        if let Some(metadata) = &self.resource_metadata {
            params.push(("resource_metadata", metadata.as_str().to_owned()));
        }
        for (key, value) in params {
            write!(f, " {key}=\"{}\"", quoted(&value))?;
        }
        Ok(())
    }
}

/// Failure while rendering a challenge.
#[derive(Debug, Error)]
pub enum ChallengeError {
    /// The rendered header value was not accepted by the HTTP library.
    #[error("invalid challenge header")]
    Header(#[source] http::header::InvalidHeaderValue),
}

fn quoted(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
