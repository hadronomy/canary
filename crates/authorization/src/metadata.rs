use std::fmt;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{ConfigError, ScopeSet};

/// OAuth protected resource identifier.
///
/// A resource URI is the audience that an access token must target. Canary
/// rejects fragments because fragments are never sent to servers and would make
/// policy ambiguous.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ResourceUri(Url);

impl ResourceUri {
    /// Creates a resource URI.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when the URL is not HTTPS or contains a
    /// fragment.
    pub fn new(value: Url) -> Result<Self, ConfigError> {
        if value.scheme() != "https" {
            return Err(ConfigError::invalid("resource URLs must use https"));
        }
        if value.fragment().is_some() {
            return Err(ConfigError::invalid("resource URLs must not contain fragments"));
        }
        Ok(Self(value))
    }

    /// Parses a resource URI from text.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when the text is not a valid resource URI.
    pub fn parse(value: &str) -> Result<Self, ConfigError> {
        Self::new(Url::parse(value).map_err(ConfigError::source)?)
    }

    /// Creates a resource URI without enforcing HTTPS.
    ///
    /// This exists for unit tests and local protocol fixtures. Production
    /// configuration should always use [`ResourceUri::new`].
    #[doc(hidden)]
    pub fn local(value: Url) -> Result<Self, ConfigError> {
        if value.fragment().is_some() {
            return Err(ConfigError::invalid("resource URLs must not contain fragments"));
        }
        Ok(Self(value))
    }

    /// Returns the RFC 9728 metadata URL derived from this resource URI.
    #[must_use]
    pub fn metadata_uri(&self) -> Self {
        let mut url = self.0.clone();
        let path = self.0.path().trim_end_matches('/');
        if path.is_empty() {
            url.set_path("/.well-known/oauth-protected-resource");
        } else {
            url.set_path(&format!("/.well-known/oauth-protected-resource{path}"));
        }
        url.set_query(None);
        url.set_fragment(None);
        Self(url)
    }

    /// Returns the underlying URL.
    #[must_use]
    #[inline(always)]
    pub fn as_url(&self) -> &Url {
        &self.0
    }

    /// Returns the resource URI as text.
    #[must_use]
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for ResourceUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("ResourceUri").field(&self.as_str()).finish()
    }
}

impl fmt::Display for ResourceUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Metadata document for RFC 9728 protected-resource discovery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProtectedResourceMetadata {
    /// Protected resource identifier.
    pub resource: ResourceUri,
    /// Authorization servers trusted to issue access tokens for the resource.
    pub authorization_servers: Vec<Url>,
    /// Bearer token transport methods supported by Canary.
    pub bearer_methods_supported: Vec<&'static str>,
    /// Scope tokens understood by the protected resource.
    pub scopes_supported: Vec<String>,
}

impl ProtectedResourceMetadata {
    /// Creates protected-resource metadata from configured values.
    #[must_use]
    pub fn new(resource: ResourceUri, authorization_servers: Vec<Url>, scopes: &ScopeSet) -> Self {
        Self {
            resource,
            authorization_servers,
            bearer_methods_supported: vec!["header"],
            scopes_supported: scopes.iter().map(str::to_owned).collect(),
        }
    }
}
