use std::time::Duration;

use canary_report::{Doc, Field, Record, Report, Value};
use jsonwebtoken::jwk::KeyAlgorithm;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::metadata::ResourceUri;
use crate::{Audience, ConfigError, Issuer, ProtectedResourceMetadata, ScopeSet};

const DEFAULT_REFRESH_INTERVAL: Duration = Duration::from_secs(300);
const DEFAULT_CLOCK_SKEW: Duration = Duration::from_secs(60);
const DEFAULT_ACCESS_TOKEN_MAX_LIFETIME: Duration = Duration::from_secs(15 * 60);
const DEFAULT_INTROSPECTION_CACHE_TTL: Duration = Duration::from_secs(30);
const DEFAULT_INTROSPECTION_CACHE_CAPACITY: u64 = 10_000;

/// JWS algorithm accepted for JWT access tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Algorithm {
    /// RSA SHA-256. This is the default production algorithm.
    #[serde(rename = "RS256")]
    Rs256,
    /// RSA PSS SHA-256.
    #[serde(rename = "PS256")]
    Ps256,
    /// ECDSA P-256 SHA-256.
    #[serde(rename = "ES256")]
    Es256,
    /// Edwards-curve Digital Signature Algorithm over Ed25519 keys.
    #[serde(rename = "EdDSA", alias = "EDDSA")]
    EdDsa,
    /// HMAC SHA-256. Intended for tests and tightly controlled deployments.
    #[serde(rename = "HS256")]
    Hs256,
}

impl Algorithm {
    #[must_use]
    #[inline(always)]
    pub(crate) fn to_jsonwebtoken(self) -> jsonwebtoken::Algorithm {
        match self {
            Self::Rs256 => jsonwebtoken::Algorithm::RS256,
            Self::Ps256 => jsonwebtoken::Algorithm::PS256,
            Self::Es256 => jsonwebtoken::Algorithm::ES256,
            Self::EdDsa => jsonwebtoken::Algorithm::EdDSA,
            Self::Hs256 => jsonwebtoken::Algorithm::HS256,
        }
    }

    #[must_use]
    #[inline(always)]
    pub(crate) fn from_jsonwebtoken(value: jsonwebtoken::Algorithm) -> Option<Self> {
        match value {
            jsonwebtoken::Algorithm::RS256 => Some(Self::Rs256),
            jsonwebtoken::Algorithm::PS256 => Some(Self::Ps256),
            jsonwebtoken::Algorithm::ES256 => Some(Self::Es256),
            jsonwebtoken::Algorithm::EdDSA => Some(Self::EdDsa),
            jsonwebtoken::Algorithm::HS256 => Some(Self::Hs256),
            _ => None,
        }
    }

    #[must_use]
    #[inline(always)]
    pub(crate) fn from_key_algorithm(value: KeyAlgorithm) -> Option<Self> {
        match value {
            KeyAlgorithm::RS256 => Some(Self::Rs256),
            KeyAlgorithm::PS256 => Some(Self::Ps256),
            KeyAlgorithm::ES256 => Some(Self::Es256),
            KeyAlgorithm::EdDSA => Some(Self::EdDsa),
            KeyAlgorithm::HS256 => Some(Self::Hs256),
            _ => None,
        }
    }
}

impl Default for Algorithm {
    #[inline(always)]
    fn default() -> Self {
        Self::Rs256
    }
}

/// Access-token formats accepted from one issuer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenFormat {
    /// JWT access tokens validated locally with JWKS.
    Jwt,
    /// Opaque access tokens validated with RFC 7662 introspection.
    Opaque,
}

/// Sorted set of accepted access-token formats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenFormatSet(Vec<TokenFormat>);

impl TokenFormatSet {
    /// Creates a token-format set.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when no token format is configured.
    pub fn new<I>(values: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = TokenFormat>,
    {
        let mut values = values.into_iter().collect::<Vec<_>>();
        values.sort();
        values.dedup();
        if values.is_empty() {
            return Err(ConfigError::invalid("auth.issuers[].token_formats cannot be empty"));
        }
        Ok(Self(values))
    }

    /// Creates the default JWT-only token-format set.
    #[must_use]
    #[inline(always)]
    pub fn jwt_only() -> Self {
        Self(vec![TokenFormat::Jwt])
    }

    /// Returns whether JWT access tokens are accepted.
    #[must_use]
    #[inline(always)]
    pub fn accepts_jwt(&self) -> bool {
        self.0.contains(&TokenFormat::Jwt)
    }

    /// Returns whether opaque access tokens are accepted.
    #[must_use]
    #[inline(always)]
    pub fn accepts_opaque(&self) -> bool {
        self.0.contains(&TokenFormat::Opaque)
    }

    /// Returns the configured token formats.
    #[must_use]
    #[inline(always)]
    pub fn as_slice(&self) -> &[TokenFormat] {
        &self.0
    }
}

impl Default for TokenFormatSet {
    #[inline(always)]
    fn default() -> Self {
        Self::jwt_only()
    }
}

/// Resource-server acceptance policy for access tokens.
///
/// This does not control how an authorization server issues tokens. It tells
/// Canary how long a token issued by this issuer may be valid before the
/// resource server treats it as a misconfiguration and rejects it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccessTokenConfig {
    /// Maximum issuer-created lifetime accepted for one access token.
    pub max_lifetime: Duration,
}

impl AccessTokenConfig {
    /// Creates access-token acceptance settings.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when `max_lifetime` is zero.
    pub fn new(max_lifetime: Duration) -> Result<Self, ConfigError> {
        if max_lifetime.is_zero() {
            return Err(ConfigError::invalid(
                "auth.issuers[].access_token.max_lifetime must be greater than zero",
            ));
        }
        Ok(Self { max_lifetime })
    }
}

impl Default for AccessTokenConfig {
    #[inline(always)]
    fn default() -> Self {
        Self { max_lifetime: DEFAULT_ACCESS_TOKEN_MAX_LIFETIME }
    }
}

/// Metadata discovery mode for one trusted issuer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryMode {
    /// Try OAuth Authorization Server Metadata, then OIDC metadata when enabled.
    Auto,
    /// Use RFC 8414 OAuth Authorization Server Metadata only.
    OAuthAuthorizationServer,
    /// Use OpenID Connect Discovery metadata only.
    OpenIdConfiguration,
}

impl Default for DiscoveryMode {
    #[inline(always)]
    fn default() -> Self {
        Self::Auto
    }
}

/// Discovery endpoints for one issuer.
#[derive(Debug, Clone, Default)]
pub struct DiscoveryConfig {
    /// Metadata discovery strategy.
    pub mode: DiscoveryMode,
    /// Explicit RFC 8414 authorization-server metadata URL.
    pub oauth_authorization_server: Option<Url>,
    /// Explicit OpenID Connect discovery metadata URL.
    pub openid_configuration: Option<Url>,
}

impl DiscoveryConfig {
    /// Creates issuer discovery settings.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when an explicit metadata URL is not HTTPS or
    /// contains a fragment.
    pub fn new(
        mode: DiscoveryMode,
        oauth_authorization_server: Option<Url>,
        openid_configuration: Option<Url>,
    ) -> Result<Self, ConfigError> {
        if let Some(uri) = &oauth_authorization_server {
            validate_https(uri, "auth.issuers[].discovery.oauth_authorization_server")?;
        }
        if let Some(uri) = &openid_configuration {
            validate_https(uri, "auth.issuers[].discovery.openid_configuration")?;
        }
        Ok(Self { mode, oauth_authorization_server, openid_configuration })
    }
}

/// Client authentication method for RFC 7662 introspection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntrospectionAuthMethod {
    /// Send client credentials with HTTP Basic authentication.
    ClientSecretBasic,
    /// Send client credentials in the form body.
    ClientSecretPost,
}

impl Default for IntrospectionAuthMethod {
    #[inline(always)]
    fn default() -> Self {
        Self::ClientSecretBasic
    }
}

/// Cache settings for successful introspection responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntrospectionCacheConfig {
    /// Maximum lifetime of a cached active introspection result.
    pub ttl: Duration,
    /// Maximum number of cached active introspection results.
    pub max_capacity: u64,
}

impl IntrospectionCacheConfig {
    /// Creates introspection cache settings.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when `ttl` or `max_capacity` is zero.
    pub fn new(ttl: Duration, max_capacity: u64) -> Result<Self, ConfigError> {
        if ttl.is_zero() {
            return Err(ConfigError::invalid(
                "auth.issuers[].introspection.cache.ttl must be greater than zero",
            ));
        }
        if max_capacity == 0 {
            return Err(ConfigError::invalid(
                "auth.issuers[].introspection.cache.max_capacity must be greater than zero",
            ));
        }
        Ok(Self { ttl, max_capacity })
    }
}

impl Default for IntrospectionCacheConfig {
    #[inline(always)]
    fn default() -> Self {
        Self {
            ttl: DEFAULT_INTROSPECTION_CACHE_TTL,
            max_capacity: DEFAULT_INTROSPECTION_CACHE_CAPACITY,
        }
    }
}

/// RFC 7662 opaque-token introspection settings.
#[derive(Debug, Clone)]
pub struct IntrospectionConfig {
    /// Optional endpoint. When absent, discovery must provide one.
    pub endpoint: Option<Url>,
    /// Resource-server client id used to authenticate at the introspection endpoint.
    pub client_id: crate::ClientId,
    /// Resource-server client secret used only for introspection.
    pub client_secret: SecretString,
    /// How Canary authenticates to the introspection endpoint.
    pub auth_method: IntrospectionAuthMethod,
    /// Successful-response cache settings.
    pub cache: IntrospectionCacheConfig,
}

impl IntrospectionConfig {
    /// Creates opaque-token introspection settings.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when the endpoint is invalid or the secret is
    /// empty.
    pub fn new(
        endpoint: Option<Url>,
        client_id: crate::ClientId,
        client_secret: SecretString,
        auth_method: IntrospectionAuthMethod,
        cache: IntrospectionCacheConfig,
    ) -> Result<Self, ConfigError> {
        if let Some(uri) = &endpoint {
            validate_https(uri, "auth.issuers[].introspection.endpoint")?;
        }
        if client_secret.expose_secret().trim().is_empty() {
            return Err(ConfigError::invalid(
                "auth.issuers[].introspection.client_secret cannot be empty",
            ));
        }
        Ok(Self { endpoint, client_id, client_secret, auth_method, cache })
    }
}

/// Authorization configuration.
#[derive(Debug, Clone, Default)]
pub enum Config {
    /// Authorization is disabled. This is the local-development default.
    #[default]
    Disabled,
    /// Authorization is enabled and must validate every protected request.
    Enabled(Box<EnabledConfig>),
}

impl Config {
    /// Returns whether authorization is enabled.
    #[must_use]
    #[inline(always)]
    pub fn is_enabled(&self) -> bool {
        matches!(self, Self::Enabled(_))
    }

    /// Returns enabled configuration when authorization is on.
    #[must_use]
    #[inline(always)]
    pub fn enabled(&self) -> Option<&EnabledConfig> {
        match self {
            Self::Disabled => None,
            Self::Enabled(cfg) => Some(cfg.as_ref()),
        }
    }
}

impl Report for Config {
    fn report(&self) -> Doc {
        let Some(cfg) = self.enabled() else {
            return Doc::builder()
                .section("auth", "Authorization")
                .field("state", "state", "disabled")
                .field("issuer_count", "issuer count", 0usize)
                .build();
        };
        Doc::builder()
            .section("auth", "Authorization")
            .field("state", "state", "enabled")
            .field("issuer_count", "issuer count", cfg.issuers().len())
            .field("api_resource", "api resource", resource(&cfg.resources().api))
            .field("mcp_resource", "mcp resource", resource(&cfg.resources().mcp))
            .field("issuers", "issuer", issuers(cfg.issuers()))
            .build()
    }
}

/// Validated authorization configuration used to build an [`crate::Authorizer`].
#[derive(Debug, Clone)]
pub struct EnabledConfig {
    resources: ResourceConfig,
    issuers: Vec<IssuerConfig>,
}

impl EnabledConfig {
    /// Creates enabled authorization configuration.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when no issuer is configured.
    pub fn new(resources: ResourceConfig, issuers: Vec<IssuerConfig>) -> Result<Self, ConfigError> {
        if issuers.is_empty() {
            return Err(ConfigError::invalid("auth.issuers must contain at least one issuer"));
        }
        for issuer in &issuers {
            issuer.validate()?;
        }
        if issuers.iter().filter(|issuer| issuer.token_formats.accepts_opaque()).count() > 1 {
            return Err(ConfigError::invalid(
                "auth.issuers can contain at most one opaque-token issuer",
            ));
        }
        Ok(Self { resources, issuers })
    }

    /// Returns protected resource settings.
    #[must_use]
    #[inline(always)]
    pub fn resources(&self) -> &ResourceConfig {
        &self.resources
    }

    /// Returns accepted token issuers.
    #[must_use]
    #[inline(always)]
    pub fn issuers(&self) -> &[IssuerConfig] {
        &self.issuers
    }
}

/// Protected resources served by Canary.
#[derive(Debug, Clone)]
pub struct ResourceConfig {
    /// REST API protected resource.
    pub api: ProtectedResourceConfig,
    /// MCP protected resource.
    pub mcp: ProtectedResourceConfig,
}

/// One RFC 9728 protected resource.
#[derive(Debug, Clone)]
pub struct ProtectedResourceConfig {
    /// Resource identifier and required audience.
    pub resource: ResourceUri,
    /// Scopes advertised in protected-resource metadata.
    pub scopes_supported: ScopeSet,
}

impl ProtectedResourceConfig {
    /// Creates RFC 9728 metadata for this protected resource.
    #[must_use]
    pub fn metadata(&self, authorization_servers: Vec<Url>) -> ProtectedResourceMetadata {
        ProtectedResourceMetadata::new(
            self.resource.clone(),
            authorization_servers,
            &self.scopes_supported,
        )
    }
}

/// One authorization server trusted by Canary.
#[derive(Debug, Clone)]
pub struct IssuerConfig {
    /// Issuer that must match the token `iss` claim.
    pub issuer: Issuer,
    /// Optional JWKS URI. When absent, Canary discovers it from authorization
    /// server metadata.
    pub jwks_uri: Option<Url>,
    /// Metadata discovery settings used when explicit endpoints are absent.
    pub discovery: DiscoveryConfig,
    /// Access-token formats accepted from this issuer.
    pub token_formats: TokenFormatSet,
    /// Explicitly accepted JWS algorithms.
    pub algorithms: Vec<Algorithm>,
    /// Audiences accepted for this issuer.
    pub audiences: Vec<Audience>,
    /// Allowed clock skew for time-based token claims.
    pub clock_skew: Duration,
    /// Resource-server acceptance policy for access-token lifetimes.
    pub access_token: AccessTokenConfig,
    /// JWKS refresh behavior.
    pub refresh: RefreshConfig,
    /// RFC 7662 introspection settings for opaque tokens.
    pub introspection: Option<IntrospectionConfig>,
}

impl IssuerConfig {
    /// Creates issuer configuration.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError`] when algorithms or audiences are empty.
    pub fn new(
        issuer: Issuer,
        jwks_uri: Option<Url>,
        algorithms: Vec<Algorithm>,
        audiences: Vec<Audience>,
        clock_skew: Duration,
        refresh: RefreshConfig,
    ) -> Result<Self, ConfigError> {
        if algorithms.is_empty() {
            return Err(ConfigError::invalid("auth.issuers[].algorithms cannot be empty"));
        }
        if audiences.is_empty() {
            return Err(ConfigError::invalid("auth.issuers[].audiences cannot be empty"));
        }
        if clock_skew.is_zero() {
            return Err(ConfigError::invalid(
                "auth.issuers[].clock_skew must be greater than zero",
            ));
        }
        if let Some(uri) = &jwks_uri {
            validate_https(uri, "auth.issuers[].jwks_uri")?;
        }
        Ok(Self {
            issuer,
            jwks_uri,
            discovery: DiscoveryConfig::default(),
            token_formats: TokenFormatSet::default(),
            algorithms,
            audiences,
            clock_skew,
            access_token: AccessTokenConfig::default(),
            refresh,
            introspection: None,
        })
    }

    fn validate(&self) -> Result<(), ConfigError> {
        AccessTokenConfig::new(self.access_token.max_lifetime)?;
        if self.token_formats.accepts_opaque() && self.introspection.is_none() {
            return Err(ConfigError::invalid(
                "auth.issuers[].introspection must be enabled when opaque tokens are accepted",
            ));
        }
        Ok(())
    }
}

/// JWKS refresh cadence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RefreshConfig {
    /// Interval between refresh attempts.
    pub interval: Duration,
}

impl Default for RefreshConfig {
    #[inline(always)]
    fn default() -> Self {
        Self { interval: DEFAULT_REFRESH_INTERVAL }
    }
}

/// Deserializable authorization configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawConfig {
    /// Whether authorization is enforced.
    pub enabled: bool,
    /// Protected resources advertised by this server.
    pub resources: RawResourceConfig,
    /// Authorization servers trusted by this server.
    pub issuers: Vec<RawIssuerConfig>,
}

/// Raw protected-resource configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawResourceConfig {
    /// REST API resource.
    pub api: RawProtectedResourceConfig,
    /// MCP resource.
    pub mcp: RawProtectedResourceConfig,
}

/// Raw protected-resource entry.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawProtectedResourceConfig {
    /// Resource URI.
    pub resource: Option<Url>,
    /// Scopes advertised in RFC 9728 metadata.
    pub scopes_supported: Vec<String>,
}

/// Raw authorization-server entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct RawIssuerConfig {
    /// Issuer URL expected in the token `iss` claim.
    pub issuer: Option<Url>,
    /// Optional JWKS URL. If absent, metadata discovery is used.
    pub jwks_uri: Option<Url>,
    /// Metadata discovery settings.
    pub discovery: RawDiscoveryConfig,
    /// Accepted access-token formats. Defaults to `jwt`, or `jwt` plus
    /// `opaque` when introspection is enabled.
    pub token_formats: Option<Vec<TokenFormat>>,
    /// Explicitly accepted signing algorithms.
    pub algorithms: Vec<Algorithm>,
    /// Accepted token audiences.
    pub audiences: Vec<String>,
    /// Clock skew allowed while validating temporal claims.
    #[serde(with = "humantime_serde")]
    pub clock_skew: Duration,
    /// Resource-server policy for accepted access-token lifetimes.
    pub access_token: RawAccessTokenConfig,
    /// JWKS refresh settings.
    pub refresh: RawRefreshConfig,
    /// RFC 7662 introspection settings for opaque tokens.
    pub introspection: RawIntrospectionConfig,
}

impl Default for RawIssuerConfig {
    fn default() -> Self {
        Self {
            issuer: None,
            jwks_uri: None,
            discovery: RawDiscoveryConfig::default(),
            token_formats: None,
            algorithms: vec![Algorithm::default()],
            audiences: Vec::new(),
            clock_skew: DEFAULT_CLOCK_SKEW,
            access_token: RawAccessTokenConfig::default(),
            refresh: RawRefreshConfig::default(),
            introspection: RawIntrospectionConfig::default(),
        }
    }
}

/// Raw metadata discovery settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawDiscoveryConfig {
    /// Metadata discovery strategy.
    pub mode: DiscoveryMode,
    /// Explicit RFC 8414 metadata URL.
    pub oauth_authorization_server: Option<Url>,
    /// Explicit OIDC discovery URL.
    pub openid_configuration: Option<Url>,
}

/// Raw `auth.issuers[].access_token` acceptance policy.
///
/// Configure the authorization server to issue access tokens at or below this
/// lifetime. Canary only enforces the limit when it receives a bearer token; it
/// does not mint, refresh, or revoke tokens.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct RawAccessTokenConfig {
    /// Maximum token lifetime Canary accepts from this issuer.
    #[serde(with = "humantime_serde")]
    pub max_lifetime: Duration,
}

impl Default for RawAccessTokenConfig {
    #[inline(always)]
    fn default() -> Self {
        Self { max_lifetime: DEFAULT_ACCESS_TOKEN_MAX_LIFETIME }
    }
}

/// Raw introspection settings.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct RawIntrospectionConfig {
    /// Whether opaque-token introspection is enabled.
    pub enabled: bool,
    /// Optional RFC 7662 endpoint. Discovery may provide it when this is absent.
    pub endpoint: Option<Url>,
    /// Resource-server client id used for introspection.
    pub client_id: Option<String>,
    /// Resource-server client secret used for introspection.
    pub client_secret: Option<SecretString>,
    /// Client authentication method.
    pub auth_method: IntrospectionAuthMethod,
    /// Successful-response cache settings.
    pub cache: RawIntrospectionCacheConfig,
}

/// Raw introspection cache settings.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct RawIntrospectionCacheConfig {
    /// Maximum successful-response cache lifetime.
    #[serde(with = "humantime_serde")]
    pub ttl: Duration,
    /// Maximum cached entries.
    pub max_capacity: u64,
}

impl Default for RawIntrospectionCacheConfig {
    #[inline(always)]
    fn default() -> Self {
        let cfg = IntrospectionCacheConfig::default();
        Self { ttl: cfg.ttl, max_capacity: cfg.max_capacity }
    }
}

/// Raw refresh settings.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct RawRefreshConfig {
    /// Interval between JWKS refresh attempts.
    #[serde(with = "humantime_serde")]
    pub interval: Duration,
}

impl Default for RawRefreshConfig {
    #[inline(always)]
    fn default() -> Self {
        Self { interval: DEFAULT_REFRESH_INTERVAL }
    }
}

impl TryFrom<RawConfig> for Config {
    type Error = ConfigError;

    fn try_from(value: RawConfig) -> Result<Self, Self::Error> {
        if !value.enabled {
            return Ok(Self::Disabled);
        }
        Ok(Self::Enabled(Box::new(EnabledConfig::new(
            ResourceConfig {
                api: ProtectedResourceConfig {
                    resource: required_resource(
                        value.resources.api.resource,
                        "auth.resources.api.resource",
                    )?,
                    scopes_supported: ScopeSet::new(value.resources.api.scopes_supported)?,
                },
                mcp: ProtectedResourceConfig {
                    resource: required_resource(
                        value.resources.mcp.resource,
                        "auth.resources.mcp.resource",
                    )?,
                    scopes_supported: ScopeSet::new(value.resources.mcp.scopes_supported)?,
                },
            },
            value.issuers.into_iter().map(IssuerConfig::try_from).collect::<Result<Vec<_>, _>>()?,
        )?)))
    }
}

impl TryFrom<RawIssuerConfig> for IssuerConfig {
    type Error = ConfigError;

    fn try_from(value: RawIssuerConfig) -> Result<Self, Self::Error> {
        let introspection = if value.introspection.enabled {
            Some(IntrospectionConfig::new(
                value.introspection.endpoint,
                value
                    .introspection
                    .client_id
                    .ok_or_else(|| {
                        ConfigError::invalid("auth.issuers[].introspection.client_id is required")
                    })
                    .and_then(crate::ClientId::new)?,
                value.introspection.client_secret.ok_or_else(|| {
                    ConfigError::invalid("auth.issuers[].introspection.client_secret is required")
                })?,
                value.introspection.auth_method,
                IntrospectionCacheConfig::new(
                    value.introspection.cache.ttl,
                    value.introspection.cache.max_capacity,
                )?,
            )?)
        } else {
            None
        };
        let token_formats = match value.token_formats {
            Some(values) => TokenFormatSet::new(values)?,
            None if introspection.is_some() => {
                TokenFormatSet::new([TokenFormat::Jwt, TokenFormat::Opaque])?
            }
            None => TokenFormatSet::default(),
        };
        let discovery = DiscoveryConfig::new(
            value.discovery.mode,
            value.discovery.oauth_authorization_server,
            value.discovery.openid_configuration,
        )?;
        let issuer = value
            .issuer
            .ok_or_else(|| ConfigError::invalid("auth.issuers[].issuer is required"))
            .and_then(Issuer::new)?;
        let audiences =
            value.audiences.into_iter().map(Audience::new).collect::<Result<Vec<_>, _>>()?;
        if value.refresh.interval.is_zero() {
            return Err(ConfigError::invalid(
                "auth.issuers[].refresh.interval must be greater than zero",
            ));
        }
        let mut cfg = Self::new(
            issuer,
            value.jwks_uri,
            value.algorithms,
            audiences,
            value.clock_skew,
            RefreshConfig { interval: value.refresh.interval },
        )?;
        cfg.access_token = AccessTokenConfig::new(value.access_token.max_lifetime)?;
        cfg.discovery = discovery;
        cfg.token_formats = token_formats;
        cfg.introspection = introspection;
        cfg.validate()?;
        Ok(cfg)
    }
}

fn required_resource(value: Option<Url>, key: &str) -> Result<ResourceUri, ConfigError> {
    value.ok_or_else(|| ConfigError::invalid(format!("{key} is required")))?.try_into()
}

fn resource(value: &ProtectedResourceConfig) -> Record {
    Record::new()
        .summary(value.resource.to_string())
        .field(Field::new("resource", "resource", value.resource.to_string()))
        .field(Field::new(
            "scopes_supported",
            "scopes supported",
            values(value.scopes_supported.iter()),
        ))
}

fn issuers(values: &[IssuerConfig]) -> Vec<Record> {
    values.iter().map(issuer).collect()
}

fn issuer(value: &IssuerConfig) -> Record {
    Record::new()
        .summary(format!(
            "{} · {} · {}",
            value.issuer,
            token_formats(value.token_formats.as_slice()),
            algorithms(value.algorithms.as_slice())
        ))
        .field(Field::new("issuer", "issuer", value.issuer.to_string()))
        .field(Field::new("jwks_uri", "jwks uri", value.jwks_uri.as_ref().map(Url::to_string)))
        .field(Field::new("discovery", "discovery", discovery(&value.discovery)))
        .field(Field::new(
            "token_formats",
            "token formats",
            token_format_values(value.token_formats.as_slice()),
        ))
        .field(Field::new(
            "algorithms",
            "algorithms",
            algorithm_values(value.algorithms.as_slice()),
        ))
        .field(Field::new(
            "audiences",
            "audiences",
            values(value.audiences.iter().map(Audience::as_str)),
        ))
        .field(Field::new("clock_skew", "clock skew", Value::duration(value.clock_skew)))
        .field(Field::new("access_token", "access token", access_token(&value.access_token)))
        .field(Field::new("refresh", "refresh", refresh(&value.refresh)))
        .field(Field::new(
            "introspection",
            "introspection",
            value.introspection.as_ref().map(introspection),
        ))
}

fn discovery(value: &DiscoveryConfig) -> Record {
    Record::new()
        .summary(discovery_mode(value.mode))
        .field(Field::new("mode", "mode", discovery_mode(value.mode)))
        .field(Field::new(
            "oauth_authorization_server",
            "oauth authorization server",
            value.oauth_authorization_server.as_ref().map(Url::to_string),
        ))
        .field(Field::new(
            "openid_configuration",
            "openid configuration",
            value.openid_configuration.as_ref().map(Url::to_string),
        ))
}

fn access_token(value: &AccessTokenConfig) -> Record {
    Record::new()
        .summary(format!("max lifetime {}", Value::duration(value.max_lifetime)))
        .field(Field::new("max_lifetime", "max lifetime", Value::duration(value.max_lifetime)))
}

fn refresh(value: &RefreshConfig) -> Record {
    Record::new().summary(format!("every {}", Value::duration(value.interval))).field(Field::new(
        "interval",
        "interval",
        Value::duration(value.interval),
    ))
}

fn introspection(value: &IntrospectionConfig) -> Record {
    Record::new()
        .summary("enabled")
        .field(Field::new("endpoint", "endpoint", value.endpoint.as_ref().map(Url::to_string)))
        .field(Field::new("client_id", "client id", value.client_id.to_string()))
        .field(Field::new("client_secret", "client secret", Value::Redacted))
        .field(Field::new("auth_method", "auth method", auth_method(value.auth_method)))
        .field(Field::new("cache", "cache", introspection_cache(&value.cache)))
}

fn introspection_cache(value: &IntrospectionCacheConfig) -> Record {
    Record::new()
        .summary(format!("{} / {} entries", Value::duration(value.ttl), value.max_capacity))
        .field(Field::new("ttl", "ttl", Value::duration(value.ttl)))
        .field(Field::new("max_capacity", "max capacity", value.max_capacity))
}

fn values<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<Value> {
    values.into_iter().map(Value::from).collect()
}

fn token_format_values(values: &[TokenFormat]) -> Vec<Value> {
    values.iter().map(|value| Value::from(token_format(*value))).collect()
}

fn algorithm_values(values: &[Algorithm]) -> Vec<Value> {
    values.iter().map(|value| Value::from(algorithm(*value))).collect()
}

fn token_formats(values: &[TokenFormat]) -> String {
    values.iter().map(|value| token_format(*value)).collect::<Vec<_>>().join(", ")
}

fn algorithms(values: &[Algorithm]) -> String {
    values.iter().map(|value| algorithm(*value)).collect::<Vec<_>>().join(", ")
}

#[inline(always)]
fn token_format(value: TokenFormat) -> &'static str {
    match value {
        TokenFormat::Jwt => "jwt",
        TokenFormat::Opaque => "opaque",
    }
}

#[inline(always)]
fn algorithm(value: Algorithm) -> &'static str {
    match value {
        Algorithm::Rs256 => "RS256",
        Algorithm::Ps256 => "PS256",
        Algorithm::Es256 => "ES256",
        Algorithm::EdDsa => "EdDSA",
        Algorithm::Hs256 => "HS256",
    }
}

#[inline(always)]
fn discovery_mode(value: DiscoveryMode) -> &'static str {
    match value {
        DiscoveryMode::Auto => "auto",
        DiscoveryMode::OAuthAuthorizationServer => "oauth_authorization_server",
        DiscoveryMode::OpenIdConfiguration => "open_id_configuration",
    }
}

#[inline(always)]
fn auth_method(value: IntrospectionAuthMethod) -> &'static str {
    match value {
        IntrospectionAuthMethod::ClientSecretBasic => "client_secret_basic",
        IntrospectionAuthMethod::ClientSecretPost => "client_secret_post",
    }
}

impl TryFrom<Url> for ResourceUri {
    type Error = ConfigError;

    fn try_from(value: Url) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

fn validate_https(value: &Url, key: &str) -> Result<(), ConfigError> {
    if value.scheme() != "https" {
        return Err(ConfigError::invalid(format!("{key} must use https")));
    }
    if value.fragment().is_some() {
        return Err(ConfigError::invalid(format!("{key} must not contain fragments")));
    }
    Ok(())
}
