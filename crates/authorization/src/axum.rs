//! Axum extractors for authorization-aware handlers.
//!
//! The server middleware validates tokens and stores [`crate::Principal`] in
//! request extensions. These extractors keep handlers from reaching into the
//! extension map by hand.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::{AuthError, BearerToken, Challenge, Principal};

/// Extracts a validated principal from request extensions.
#[derive(Debug, Clone)]
pub struct Authenticated(pub Principal);

impl Authenticated {
    /// Consumes the extractor and returns the principal.
    #[must_use]
    #[inline(always)]
    pub fn into_inner(self) -> Principal {
        self.0
    }
}

impl<S> FromRequestParts<S> for Authenticated
where
    S: Send + Sync,
{
    type Rejection = crate::AuthError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts.extensions.get::<Principal>().cloned().map(Self).ok_or(crate::AuthError::Disabled)
    }
}

/// Extracts an unverified bearer token from the `Authorization` header.
#[derive(Debug, Clone)]
pub struct Bearer(pub BearerToken);

impl Bearer {
    /// Consumes the extractor and returns the token.
    #[must_use]
    #[inline(always)]
    pub fn into_inner(self) -> BearerToken {
        self.0
    }
}

impl<S> FromRequestParts<S> for Bearer
where
    S: Send + Sync,
{
    type Rejection = crate::AuthError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        BearerToken::from_headers(&parts.headers).map(Self).map_err(crate::AuthError::from)
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let challenge = match &self {
            Self::InsufficientScope { required } => {
                Challenge::insufficient_scope(required.clone(), None)
            }
            Self::InvalidToken { .. } => Challenge::invalid_token(None),
            Self::Bearer(_) | Self::QueryToken | Self::Disabled => Challenge::missing(None),
            Self::Fetch { .. } | Self::Config(_) => Challenge::invalid_token(None),
        };
        let status = match self {
            Self::InsufficientScope { .. } => StatusCode::FORBIDDEN,
            _ => StatusCode::UNAUTHORIZED,
        };
        let mut response = status.into_response();
        if let Ok(value) = challenge.to_header_value() {
            response.headers_mut().insert(header::WWW_AUTHENTICATE, value);
        }
        response
    }
}
