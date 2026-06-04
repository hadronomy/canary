//! Disabled opaque-token introspection boundary.
//!
//! This module is compiled when the `introspection` feature is absent. It keeps
//! the main authorizer small while making the failure mode explicit: Canary can
//! parse introspection settings, but cannot accept opaque tokens unless the
//! feature is built in.

use url::Url;

use crate::{AuthError, ConfigError, IssuerConfig, Principal};

/// Placeholder authority used when RFC 7662 support is not compiled.
#[derive(Debug, Clone)]
pub(super) struct IntrospectionAuthority;

impl IntrospectionAuthority {
    /// Refuses to build opaque-token support without the feature.
    ///
    /// # Errors
    ///
    /// Always returns [`ConfigError`] explaining that opaque-token validation
    /// requires the `introspection` feature.
    pub(super) fn new(
        _: &IssuerConfig,
        _: &crate::IntrospectionConfig,
        _: Url,
    ) -> Result<Self, AuthError> {
        Err(ConfigError::invalid(
            "opaque tokens require the canary-authorization introspection feature",
        )
        .into())
    }

    /// Rejects opaque-token verification when the feature is absent.
    ///
    /// # Errors
    ///
    /// Always returns [`AuthError::InvalidToken`]. In normal configuration this
    /// method is unreachable because [`Self::new`] prevents opaque issuers from
    /// being installed.
    pub(super) async fn verify(
        &self,
        _: &reqwest::Client,
        _: &crate::BearerToken,
    ) -> Result<Principal, AuthError> {
        Err(AuthError::invalid())
    }
}
