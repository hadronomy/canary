//! Authorization-server metadata discovery.
//!
//! Canary accepts explicit endpoint overrides first, then fills the gaps from
//! RFC 8414 OAuth metadata or OpenID Connect discovery when those features are
//! available. Discovery never follows redirects; the shared HTTP client is
//! configured that way at the authorizer boundary.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use url::Url;

use crate::{AuthError, ConfigError, DiscoveryMode, IssuerConfig};

/// Endpoint metadata resolved for one issuer.
///
/// The fields are optional while discovery is still merging sources. The final
/// value must satisfy the issuer's configured token formats before it leaves
/// this module.
#[derive(Debug, Clone, Default)]
pub(super) struct ResolvedMetadata {
    pub(super) jwks_uri: Option<Url>,
    pub(super) introspection_endpoint: Option<Url>,
}

impl ResolvedMetadata {
    #[inline(always)]
    fn from_config(cfg: &IssuerConfig) -> Self {
        Self {
            jwks_uri: cfg.jwks_uri.clone(),
            introspection_endpoint: cfg.introspection.as_ref().and_then(|cfg| cfg.endpoint.clone()),
        }
    }

    fn merge(&mut self, value: Self) {
        if self.jwks_uri.is_none() {
            self.jwks_uri = value.jwks_uri;
        }
        if self.introspection_endpoint.is_none() {
            self.introspection_endpoint = value.introspection_endpoint;
        }
    }

    fn satisfies(&self, cfg: &IssuerConfig) -> bool {
        (!cfg.token_formats.accepts_jwt() || self.jwks_uri.is_some())
            && (!cfg.token_formats.accepts_opaque() || self.introspection_endpoint.is_some())
    }
}

pub(super) async fn resolve(
    client: &reqwest::Client,
    cfg: &IssuerConfig,
) -> Result<ResolvedMetadata, AuthError> {
    let mut metadata = ResolvedMetadata::from_config(cfg);
    if metadata.satisfies(cfg) {
        return Ok(metadata);
    }

    match cfg.discovery.mode {
        DiscoveryMode::Auto => {
            if let Some(value) = fetch_oauth(client, cfg, true).await? {
                metadata.merge(value);
            }
            if !metadata.satisfies(cfg)
                && let Some(value) = fetch_oidc(client, cfg, true).await?
            {
                metadata.merge(value);
            }
        }
        DiscoveryMode::OAuthAuthorizationServer => {
            metadata.merge(fetch_oauth(client, cfg, false).await?.ok_or_else(|| {
                ConfigError::invalid("authorization-server metadata is not available")
            })?);
        }
        DiscoveryMode::OpenIdConfiguration => {
            metadata.merge(
                fetch_oidc(client, cfg, false).await?.ok_or_else(|| {
                    ConfigError::invalid("OpenID Connect metadata is not available")
                })?,
            );
        }
    }

    if metadata.satisfies(cfg) {
        return Ok(metadata);
    }
    Err(ConfigError::invalid("issuer metadata did not provide required endpoints").into())
}

async fn fetch_oauth(
    client: &reqwest::Client,
    cfg: &IssuerConfig,
    optional: bool,
) -> Result<Option<ResolvedMetadata>, AuthError> {
    let uri = cfg
        .discovery
        .oauth_authorization_server
        .clone()
        .unwrap_or_else(|| oauth_url(cfg.issuer.as_url()));
    let Some(metadata) = fetch_json::<AuthorizationServerMetadata>(client, uri, optional).await?
    else {
        return Ok(None);
    };
    if metadata.issuer != *cfg.issuer.as_url() {
        return Err(AuthError::invalid());
    }
    let mut resolved = ResolvedMetadata::default();
    if let Some(uri) = metadata.jwks_uri {
        validate(&uri, "discovered jwks_uri")?;
        resolved.jwks_uri = Some(uri);
    }
    if let Some(uri) = metadata.introspection_endpoint {
        validate(&uri, "discovered introspection_endpoint")?;
        resolved.introspection_endpoint = Some(uri);
    }
    Ok(Some(resolved))
}

#[cfg(feature = "oidc-discovery")]
async fn fetch_oidc(
    client: &reqwest::Client,
    cfg: &IssuerConfig,
    optional: bool,
) -> Result<Option<ResolvedMetadata>, AuthError> {
    for uri in oidc_urls(cfg) {
        let Some(value) = fetch_json::<serde_json::Value>(client, uri, optional).await? else {
            continue;
        };
        let metadata: openidconnect::core::CoreProviderMetadata =
            serde_json::from_value(value.clone()).map_err(AuthError::fetch)?;
        if metadata.issuer().url() != cfg.issuer.as_url() {
            return Err(AuthError::invalid());
        }
        let mut resolved = ResolvedMetadata::default();
        let jwks = metadata.jwks_uri().url().clone();
        validate(&jwks, "discovered jwks_uri")?;
        resolved.jwks_uri = Some(jwks);
        if let Some(uri) = parse_url_field(&value, "introspection_endpoint")? {
            validate(&uri, "discovered introspection_endpoint")?;
            resolved.introspection_endpoint = Some(uri);
        }
        return Ok(Some(resolved));
    }
    Ok(None)
}

#[cfg(not(feature = "oidc-discovery"))]
async fn fetch_oidc(
    _: &reqwest::Client,
    _: &IssuerConfig,
    optional: bool,
) -> Result<Option<ResolvedMetadata>, AuthError> {
    if optional {
        return Ok(None);
    }
    Err(ConfigError::invalid(
        "OpenID Connect discovery requires the canary-authorization oidc-discovery feature",
    )
    .into())
}

async fn fetch_json<T>(
    client: &reqwest::Client,
    uri: Url,
    optional: bool,
) -> Result<Option<T>, AuthError>
where
    T: DeserializeOwned,
{
    let response = client.get(uri).send().await.map_err(AuthError::fetch)?;
    if optional && response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = response.error_for_status().map_err(AuthError::fetch)?;
    response.json::<T>().await.map(Some).map_err(AuthError::fetch)
}

fn oauth_url(issuer: &Url) -> Url {
    let mut url = issuer.clone();
    let path = issuer.path().trim_end_matches('/');
    url.set_path(&format!("/.well-known/oauth-authorization-server{path}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

#[cfg(feature = "oidc-discovery")]
fn oidc_urls(cfg: &IssuerConfig) -> Vec<Url> {
    if let Some(uri) = &cfg.discovery.openid_configuration {
        return vec![uri.clone()];
    }
    let mut urls = Vec::with_capacity(2);
    let mut path = cfg.issuer.as_url().clone();
    let base = cfg.issuer.as_url().path().trim_end_matches('/');
    path.set_path(&format!("/.well-known/openid-configuration{base}"));
    path.set_query(None);
    path.set_fragment(None);
    urls.push(path);

    let mut relative = cfg.issuer.as_url().clone();
    let path = if base.is_empty() {
        "/.well-known/openid-configuration".to_owned()
    } else {
        format!("{base}/.well-known/openid-configuration")
    };
    relative.set_path(&path);
    relative.set_query(None);
    relative.set_fragment(None);
    if !urls.iter().any(|value| value == &relative) {
        urls.push(relative);
    }
    urls
}

#[cfg(feature = "oidc-discovery")]
fn parse_url_field(value: &serde_json::Value, key: &str) -> Result<Option<Url>, AuthError> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(Url::parse)
        .transpose()
        .map_err(AuthError::invalid_token)
}

fn validate(value: &Url, key: &str) -> Result<(), ConfigError> {
    if value.scheme() != "https" {
        return Err(ConfigError::invalid(format!("{key} must use https")));
    }
    if value.fragment().is_some() {
        return Err(ConfigError::invalid(format!("{key} must not contain fragments")));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct AuthorizationServerMetadata {
    issuer: Url,
    #[serde(default)]
    jwks_uri: Option<Url>,
    #[serde(default)]
    introspection_endpoint: Option<Url>,
}
