//! Access-token verification and transport-neutral authorization.
//!
//! The public [`Authorizer`] keeps the server-facing API small: verify a bearer
//! token, then ask whether the resulting principal may touch a resource. Issuer
//! metadata, JWKS compilation, and optional opaque-token introspection stay
//! behind this module boundary.

mod discovery;
#[cfg(feature = "introspection")]
mod introspection;
#[cfg(not(feature = "introspection"))]
mod introspection_disabled;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use arc_swap::ArcSwap;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use discovery::resolve as resolve_metadata;
#[cfg(feature = "introspection")]
use introspection::IntrospectionAuthority;
#[cfg(not(feature = "introspection"))]
use introspection_disabled::IntrospectionAuthority;
use jsonwebtoken::jwk::{AlgorithmParameters, EllipticCurve, Jwk, KeyOperations, PublicKeyUse};
use jsonwebtoken::{DecodingKey, Header, Validation, decode, decode_header};
use reqwest::redirect::Policy as RedirectPolicy;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use url::Url;

use crate::{
    Action, Algorithm, Audience, AuthError, ClientId, ConfigError, Decision, Denial, EnabledConfig,
    EntitlementSet, GroupSet, IssuerConfig, JsonWebKeySet, Principal, ProtectedResourceMetadata,
    Resource, RoleSet, ScopeSet, Subject,
};

/// Validates access tokens and evaluates Canary authorization policy.
#[derive(Debug, Clone)]
pub struct Authorizer {
    inner: Arc<Inner>,
}

impl Authorizer {
    /// Builds an authorizer by loading JWKS documents from configured issuers.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError`] when metadata, JWKS, or introspection setup fails.
    pub async fn from_config(cfg: EnabledConfig) -> Result<Self, AuthError> {
        ensure_crypto_provider();
        let client = client()?;
        let mut issuers = Vec::with_capacity(cfg.issuers().len());
        for issuer in cfg.issuers() {
            issuers.push(IssuerAuthority::from_config(&client, issuer.clone()).await?);
        }
        Ok(Self { inner: Arc::new(Inner { cfg, issuers, client }) })
    }

    /// Builds an authorizer from already-loaded JWKS values.
    ///
    /// This is useful for tests, embedded deployments, and callers that own
    /// their own key distribution.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError`] when the number of JWKS values does not match the
    /// number of configured issuers, or when any key set cannot verify one of
    /// the configured algorithms.
    pub fn from_jwks(cfg: EnabledConfig, keys: Vec<JsonWebKeySet>) -> Result<Self, AuthError> {
        ensure_crypto_provider();
        if cfg.issuers().len() != keys.len() {
            return Err(ConfigError::invalid("one JWKS document is required per issuer").into());
        }
        let client = client()?;
        let issuers = cfg
            .issuers()
            .iter()
            .cloned()
            .zip(keys)
            .map(|(cfg, jwks)| IssuerAuthority::from_jwks(cfg, &jwks))
            .collect::<Result<Vec<_>, AuthError>>()?;
        Ok(Self { inner: Arc::new(Inner { cfg, issuers, client }) })
    }

    /// Verifies a bearer token and returns the authenticated principal.
    ///
    /// JWT access tokens are verified locally. Opaque tokens use RFC 7662
    /// introspection when issuer settings allow them.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError::InvalidToken`] when signature, issuer, audience,
    /// algorithm, type, claims, or introspection validation fail.
    pub async fn verify(&self, token: &crate::BearerToken) -> Result<Principal, AuthError> {
        match token_kind(token.as_str()) {
            TokenKind::Jwt => self.verify_jwt(token),
            TokenKind::Opaque => self.verify_opaque(token).await,
        }
    }

    /// Evaluates Canary's scope policy for one action and resource.
    ///
    /// Database-backed containment checks should run alongside this decision
    /// once the resource service exists. The scope stage is intentionally kept
    /// here so every transport uses one vocabulary.
    #[must_use]
    pub fn authorize(
        &self,
        principal: &Principal,
        action: Action,
        resource: &Resource,
    ) -> Decision {
        let broad = format!("canary:{}", action.as_scope_token());
        let scoped =
            format!("canary:{}:{}", resource.kind().as_scope_token(), action.as_scope_token());
        if principal.has_scope("canary:admin")
            || principal.has_scope(&broad)
            || principal.has_scope(&scoped)
        {
            return Decision::Allow;
        }
        Decision::Deny(Denial::InsufficientScope {
            required: ScopeSet::new([scoped, broad]).expect("generated scopes are valid"),
        })
    }

    /// Refreshes all remote JWKS documents immediately.
    ///
    /// A failed refresh leaves the previous key ring in place.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError`] when any configured JWKS endpoint fails.
    pub async fn refresh(&self) -> Result<(), AuthError> {
        ensure_crypto_provider();
        for issuer in &self.inner.issuers {
            let Some(keys) = &issuer.keys else {
                continue;
            };
            let uri = issuer
                .jwks_uri
                .clone()
                .ok_or_else(|| ConfigError::invalid("JWT issuers need a JWKS URI"))?;
            let jwks = fetch_jwks_uri(&self.inner.client, uri).await?;
            keys.store(Arc::new(KeyRing::compile(&jwks, &issuer.cfg)?));
        }
        Ok(())
    }

    /// Returns the shortest configured JWKS refresh interval.
    #[must_use]
    pub fn refresh_interval(&self) -> Duration {
        self.inner
            .cfg
            .issuers()
            .iter()
            .map(|issuer| issuer.refresh.interval)
            .min()
            .unwrap_or(Duration::from_secs(300))
    }

    /// Returns RFC 9728 metadata for the REST API protected resource.
    #[must_use]
    #[inline(always)]
    pub fn api_metadata(&self) -> ProtectedResourceMetadata {
        self.inner.cfg.resources().api.metadata(self.authorization_servers())
    }

    /// Returns RFC 9728 metadata for the MCP protected resource.
    #[must_use]
    #[inline(always)]
    pub fn mcp_metadata(&self) -> ProtectedResourceMetadata {
        self.inner.cfg.resources().mcp.metadata(self.authorization_servers())
    }

    /// Returns the metadata URI to advertise for the REST API.
    #[must_use]
    #[inline(always)]
    pub fn api_metadata_uri(&self) -> crate::ResourceUri {
        self.inner.cfg.resources().api.resource.metadata_uri()
    }

    /// Returns the metadata URI to advertise for MCP.
    #[must_use]
    #[inline(always)]
    pub fn mcp_metadata_uri(&self) -> crate::ResourceUri {
        self.inner.cfg.resources().mcp.resource.metadata_uri()
    }

    fn verify_jwt(&self, token: &crate::BearerToken) -> Result<Principal, AuthError> {
        ensure_crypto_provider();
        let header = decode_header(token.as_str()).map_err(AuthError::invalid_token)?;
        validate_header(&header)?;
        let alg = Algorithm::from_jsonwebtoken(header.alg).ok_or_else(AuthError::invalid)?;
        let kid = header.kid.as_deref().ok_or_else(AuthError::invalid)?;
        let issuer = untrusted_issuer(token.as_str())?;
        let authority = self
            .inner
            .issuers
            .iter()
            .find(|item| item.cfg.issuer.as_str() == issuer)
            .ok_or_else(AuthError::invalid)?;
        if !authority.cfg.token_formats.accepts_jwt() {
            return Err(AuthError::invalid());
        }
        let keys = authority.keys.as_ref().ok_or_else(AuthError::invalid)?.load();
        let key = keys.get(kid, alg).ok_or_else(AuthError::invalid)?;
        let claims = decode::<AccessClaims>(token.as_str(), key, &validator(&authority.cfg)?)
            .map_err(AuthError::invalid_token)?
            .claims;
        validate_access_profile(&claims, &authority.cfg)?;
        Principal::try_from(claims)
    }

    async fn verify_opaque(&self, token: &crate::BearerToken) -> Result<Principal, AuthError> {
        let authority = self
            .inner
            .issuers
            .iter()
            .find(|item| item.cfg.token_formats.accepts_opaque())
            .ok_or_else(AuthError::invalid)?;
        authority
            .introspection
            .as_ref()
            .ok_or_else(AuthError::invalid)?
            .verify(&self.inner.client, token)
            .await
    }

    #[inline(always)]
    fn authorization_servers(&self) -> Vec<Url> {
        self.inner.cfg.issuers().iter().map(|issuer| issuer.issuer.as_url().clone()).collect()
    }
}

#[derive(Debug)]
struct Inner {
    cfg: EnabledConfig,
    issuers: Vec<IssuerAuthority>,
    client: reqwest::Client,
}

/// Verification material and optional opaque-token support for one issuer.
#[derive(Debug)]
struct IssuerAuthority {
    cfg: IssuerConfig,
    jwks_uri: Option<Url>,
    keys: Option<ArcSwap<KeyRing>>,
    introspection: Option<IntrospectionAuthority>,
}

impl IssuerAuthority {
    async fn from_config(client: &reqwest::Client, cfg: IssuerConfig) -> Result<Self, AuthError> {
        let metadata = resolve_metadata(client, &cfg).await?;
        let keys = if cfg.token_formats.accepts_jwt() {
            let uri = metadata
                .jwks_uri
                .clone()
                .ok_or_else(|| ConfigError::invalid("JWT issuers need a JWKS URI"))?;
            let jwks = fetch_jwks_uri(client, uri).await?;
            Some(ArcSwap::from_pointee(KeyRing::compile(&jwks, &cfg)?))
        } else {
            None
        };
        let introspection = match &cfg.introspection {
            Some(introspection) => {
                let endpoint = metadata.introspection_endpoint.clone().ok_or_else(|| {
                    ConfigError::invalid("opaque issuers need an introspection endpoint")
                })?;
                Some(IntrospectionAuthority::new(&cfg, introspection, endpoint)?)
            }
            None => None,
        };

        Ok(Self { jwks_uri: metadata.jwks_uri, keys, introspection, cfg })
    }

    fn from_jwks(cfg: IssuerConfig, jwks: &JsonWebKeySet) -> Result<Self, AuthError> {
        let keys = if cfg.token_formats.accepts_jwt() {
            Some(ArcSwap::from_pointee(KeyRing::compile(jwks, &cfg)?))
        } else {
            None
        };
        let introspection = match &cfg.introspection {
            Some(introspection) => {
                let endpoint = introspection.endpoint.clone().ok_or_else(|| {
                    ConfigError::invalid(
                        "from_jwks requires an explicit introspection endpoint for opaque issuers",
                    )
                })?;
                Some(IntrospectionAuthority::new(&cfg, introspection, endpoint)?)
            }
            None => None,
        };
        Ok(Self { jwks_uri: cfg.jwks_uri.clone(), keys, introspection, cfg })
    }
}

/// Stable lookup key for a verification key inside a JWKS-derived key ring.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct KeySelector {
    kid: SmolStr,
    alg: Algorithm,
}

/// Compiled verification keys selected by `kid` and accepted JWS algorithm.
#[derive(Debug)]
struct KeyRing {
    keys: HashMap<KeySelector, DecodingKey>,
}

impl KeyRing {
    fn compile(jwks: &JsonWebKeySet, cfg: &IssuerConfig) -> Result<Self, ConfigError> {
        let mut keys = HashMap::new();
        for jwk in &jwks.as_inner().keys {
            if !is_verification_key(jwk) {
                continue;
            }
            let algs = algorithms_for(jwk, &cfg.algorithms)?;
            if algs.is_empty() {
                continue;
            }
            let kid =
                jwk.common.key_id.as_deref().ok_or_else(|| {
                    ConfigError::invalid("JWKS verification keys must include kid")
                })?;
            let key = DecodingKey::from_jwk(jwk).map_err(ConfigError::source)?;
            for alg in algs {
                let selector = KeySelector { kid: SmolStr::new(kid), alg };
                if keys.insert(selector, key.clone()).is_some() {
                    return Err(ConfigError::invalid(
                        "JWKS contains duplicate usable kid and alg entries",
                    ));
                }
            }
        }
        if keys.is_empty() {
            return Err(ConfigError::invalid("JWKS does not contain any usable verification keys"));
        }
        Ok(Self { keys })
    }

    #[must_use]
    #[inline(always)]
    fn get(&self, kid: &str, alg: Algorithm) -> Option<&DecodingKey> {
        self.keys.get(&KeySelector { kid: SmolStr::new(kid), alg })
    }
}

/// Coarse token shape chosen before expensive verification begins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Jwt,
    Opaque,
}

fn client() -> Result<reqwest::Client, AuthError> {
    reqwest::Client::builder()
        .redirect(RedirectPolicy::none())
        .user_agent(concat!("canary-authorization/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(AuthError::fetch)
}

#[inline(always)]
fn ensure_crypto_provider() {
    #[cfg(all(feature = "jwt-rust-crypto", feature = "jwt-aws-lc-rs"))]
    let _ = jsonwebtoken::crypto::rust_crypto::DEFAULT_PROVIDER.install_default();
}

fn validator(cfg: &IssuerConfig) -> Result<Validation, AuthError> {
    let mut algorithms = cfg.algorithms.iter().map(|alg| alg.to_jsonwebtoken()).collect::<Vec<_>>();
    let Some(first) = algorithms.first().copied() else {
        return Err(ConfigError::invalid("auth.issuers[].algorithms cannot be empty").into());
    };
    let mut validator = Validation::new(first);
    validator.algorithms = std::mem::take(&mut algorithms);
    validator.leeway = cfg.clock_skew.as_secs();
    validator.validate_nbf = true;
    validator.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validator.set_issuer(&[cfg.issuer.as_str()]);
    validator.set_audience(&cfg.audiences.iter().map(Audience::as_str).collect::<Vec<_>>());
    Ok(validator)
}

fn validate_header(header: &Header) -> Result<(), AuthError> {
    match header.typ.as_deref() {
        Some("at+jwt" | "application/at+jwt") => {}
        _ => return Err(AuthError::invalid()),
    }
    if Algorithm::from_jsonwebtoken(header.alg).is_none() {
        return Err(AuthError::invalid());
    }
    if header.kid.as_deref().is_none_or(str::is_empty) {
        return Err(AuthError::invalid());
    }
    Ok(())
}

fn validate_access_profile(claims: &AccessClaims, cfg: &IssuerConfig) -> Result<(), AuthError> {
    let client_id = claims.client_id.as_ref().ok_or_else(AuthError::invalid)?;
    crate::principal::validate_text(client_id.as_str(), "client id")
        .map_err(AuthError::invalid_token)?;
    let issued_at = claims.issued_at.ok_or_else(AuthError::invalid)?;
    let jwt_id = claims.jwt_id.as_ref().ok_or_else(AuthError::invalid)?;
    crate::principal::validate_text(jwt_id.as_str(), "jwt id").map_err(AuthError::invalid_token)?;
    validate_token_lifetime(claims.exp, issued_at, cfg.access_token.max_lifetime)?;
    if issued_at > jsonwebtoken::get_current_timestamp().saturating_add(cfg.clock_skew.as_secs()) {
        return Err(AuthError::invalid());
    }
    Ok(())
}

pub(super) fn validate_token_lifetime(
    expires_at: u64,
    issued_at: u64,
    max_lifetime: Duration,
) -> Result<(), AuthError> {
    let lifetime = expires_at.checked_sub(issued_at).ok_or_else(AuthError::invalid)?;
    if Duration::from_secs(lifetime) > max_lifetime {
        return Err(AuthError::invalid());
    }
    Ok(())
}

async fn fetch_jwks_uri(client: &reqwest::Client, uri: Url) -> Result<JsonWebKeySet, AuthError> {
    client
        .get(uri)
        .send()
        .await
        .map_err(AuthError::fetch)?
        .error_for_status()
        .map_err(AuthError::fetch)?
        .json::<JsonWebKeySet>()
        .await
        .map_err(AuthError::fetch)
}

fn untrusted_issuer(token: &str) -> Result<String, AuthError> {
    let mut parts = token.split('.');
    let _ = parts.next();
    let payload = parts.next().ok_or_else(AuthError::invalid)?;
    let payload = URL_SAFE_NO_PAD.decode(payload).map_err(AuthError::invalid_token)?;
    let claims: UntrustedClaims =
        serde_json::from_slice(&payload).map_err(AuthError::invalid_token)?;
    claims.iss.ok_or_else(AuthError::invalid)
}

fn token_kind(token: &str) -> TokenKind {
    let mut parts = token.split('.');
    if parts.next().is_some()
        && parts.next().is_some()
        && parts.next().is_some()
        && parts.next().is_none()
    {
        return TokenKind::Jwt;
    }
    TokenKind::Opaque
}

fn is_verification_key(jwk: &Jwk) -> bool {
    let use_ok = jwk
        .common
        .public_key_use
        .as_ref()
        .is_none_or(|value| matches!(value, PublicKeyUse::Signature));
    let ops_ok = jwk
        .common
        .key_operations
        .as_ref()
        .is_none_or(|values| values.iter().any(|value| matches!(value, KeyOperations::Verify)));
    use_ok && ops_ok
}

fn algorithms_for(jwk: &Jwk, accepted: &[Algorithm]) -> Result<Vec<Algorithm>, ConfigError> {
    if let Some(alg) = jwk.common.key_algorithm {
        let Some(alg) = Algorithm::from_key_algorithm(alg) else {
            return Ok(Vec::new());
        };
        if !matches_key_algorithm(jwk, alg) {
            return Err(ConfigError::invalid("JWK alg does not match key material"));
        }
        if accepted.contains(&alg) {
            return Ok(vec![alg]);
        }
        return Ok(Vec::new());
    }
    Ok(accepted.iter().copied().filter(|alg| matches_key_algorithm(jwk, *alg)).collect())
}

fn matches_key_algorithm(jwk: &Jwk, alg: Algorithm) -> bool {
    match (&jwk.algorithm, alg) {
        (AlgorithmParameters::RSA(_), Algorithm::Rs256 | Algorithm::Ps256) => true,
        (AlgorithmParameters::EllipticCurve(params), Algorithm::Es256) => {
            params.curve == EllipticCurve::P256
        }
        (AlgorithmParameters::OctetKeyPair(params), Algorithm::EdDsa) => {
            params.curve == EllipticCurve::Ed25519
        }
        (AlgorithmParameters::OctetKey(_), Algorithm::Hs256) => true,
        _ => false,
    }
}

#[derive(Debug, Deserialize)]
struct UntrustedClaims {
    iss: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AccessClaims {
    iss: String,
    sub: String,
    aud: AudienceClaim,
    exp: u64,
    #[serde(default)]
    #[allow(dead_code)]
    nbf: Option<u64>,
    #[serde(default)]
    scope: Option<ScopeClaim>,
    #[serde(default)]
    scp: Option<ScopeClaim>,
    #[serde(default)]
    client_id: Option<SmolStr>,
    #[serde(default, rename = "iat")]
    issued_at: Option<u64>,
    #[serde(default, rename = "jti")]
    jwt_id: Option<SmolStr>,
    #[serde(default)]
    roles: ValuesClaim,
    #[serde(default)]
    groups: ValuesClaim,
    #[serde(default)]
    entitlements: ValuesClaim,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum AudienceClaim {
    One(String),
    Many(Vec<String>),
}

impl AudienceClaim {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::One(value) => vec![value],
            Self::Many(values) => values,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum ScopeClaim {
    Text(String),
    Many(Vec<String>),
}

impl ScopeClaim {
    fn extend_scopes(&self, values: &mut Vec<String>) {
        match self {
            Self::Text(value) => values.extend(value.split_ascii_whitespace().map(str::to_owned)),
            Self::Many(items) => values.extend(items.iter().cloned()),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(untagged)]
enum ValuesClaim {
    One(SmolStr),
    Many(Vec<SmolStr>),
    #[default]
    Empty,
}

impl ValuesClaim {
    fn values(&self) -> Vec<SmolStr> {
        match self {
            Self::One(value) => vec![value.clone()],
            Self::Many(values) => values.clone(),
            Self::Empty => Vec::new(),
        }
    }
}

impl TryFrom<AccessClaims> for Principal {
    type Error = AuthError;

    fn try_from(value: AccessClaims) -> Result<Self, Self::Error> {
        let audiences = value
            .aud
            .into_vec()
            .into_iter()
            .map(Audience::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(AuthError::invalid_token)?;
        let mut scopes = Vec::new();
        if let Some(scope) = &value.scope {
            scope.extend_scopes(&mut scopes);
        }
        if let Some(scope) = &value.scp {
            scope.extend_scopes(&mut scopes);
        }
        Ok(Self::new(
            crate::Issuer::parse(&value.iss).map_err(AuthError::invalid_token)?,
            Subject::new(value.sub).map_err(AuthError::invalid_token)?,
            ClientId::new(value.client_id.ok_or_else(AuthError::invalid)?)
                .map_err(AuthError::invalid_token)?,
            audiences,
            ScopeSet::new(scopes).map_err(AuthError::invalid_token)?,
            RoleSet::new(value.roles.values()).map_err(AuthError::invalid_token)?,
            GroupSet::new(value.groups.values()).map_err(AuthError::invalid_token)?,
            EntitlementSet::new(value.entitlements.values()).map_err(AuthError::invalid_token)?,
        ))
    }
}
