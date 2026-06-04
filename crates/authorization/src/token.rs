use std::fmt;

use headers::authorization::Bearer;
use headers::{Authorization, HeaderMapExt};
use http::HeaderMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Bearer access token accepted from the HTTP `Authorization` header.
///
/// The token deliberately redacts its [`std::fmt::Debug`] and
/// [`std::fmt::Display`] output. Use
/// [`BearerToken::as_str`] only at the validation boundary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BearerToken(String);

impl BearerToken {
    /// Creates a token from raw bearer-token text.
    ///
    /// # Errors
    ///
    /// Returns [`BearerTokenError::Malformed`] when the token is empty or
    /// contains whitespace.
    pub fn new(value: impl Into<String>) -> Result<Self, BearerTokenError> {
        let value = value.into();
        if value.is_empty() || value.chars().any(char::is_whitespace) {
            return Err(BearerTokenError::Malformed);
        }
        Ok(Self(value))
    }

    /// Extracts a bearer token from HTTP headers.
    ///
    /// # Errors
    ///
    /// Returns [`BearerTokenError`] when the header is missing, not UTF-8, or
    /// does not use the bearer authentication scheme.
    pub fn from_headers(headers: &HeaderMap) -> Result<Self, BearerTokenError> {
        headers
            .typed_get::<Authorization<Bearer>>()
            .ok_or(BearerTokenError::Missing)
            .and_then(|value| Self::new(value.token()))
    }

    /// Returns the sensitive token text.
    #[must_use]
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for BearerToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BearerToken(\"***\")")
    }
}

impl fmt::Display for BearerToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// Why bearer-token extraction failed before JWT validation began.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum BearerTokenError {
    /// The `Authorization` header was absent.
    #[error("missing bearer token")]
    Missing,
    /// The `Authorization` header was not a valid bearer credential.
    #[error("malformed bearer token")]
    Malformed,
}
