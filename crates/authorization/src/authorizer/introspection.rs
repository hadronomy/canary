#![cfg(feature = "introspection")]

//! RFC 7662 opaque-token introspection for one trusted issuer.
//!
//! This module is intentionally compiled as a single feature-gated unit. When
//! `introspection` is enabled, opaque bearer tokens can be checked with the
//! authorization server before Canary builds the same typed [`Principal`] used
//! for JWT access tokens.

use std::time::{Duration, Instant};

use moka::Expiry;
use moka::future::Cache;
use oauth2::TokenIntrospectionResponse;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use super::{ScopeClaim, ValuesClaim, validate_token_lifetime};
use crate::{
    Audience, AuthError, ClientId, EntitlementSet, GroupSet, IssuerConfig, Principal,
    PrincipalKind, RoleSet, ScopeSet, Subject,
};

/// OAuth2 client fixed to the RFC 7662 introspection endpoint being configured.
type Client = oauth2::Client<
    oauth2::StandardErrorResponse<oauth2::basic::BasicErrorResponseType>,
    oauth2::StandardTokenResponse<oauth2::EmptyExtraTokenFields, oauth2::basic::BasicTokenType>,
    oauth2::StandardTokenIntrospectionResponse<Extra, oauth2::basic::BasicTokenType>,
    oauth2::StandardRevocableToken,
    oauth2::basic::BasicRevocationErrorResponse,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointSet,
    oauth2::EndpointNotSet,
    oauth2::EndpointNotSet,
>;

/// Verifies opaque access tokens through an issuer's introspection endpoint.
///
/// The authority owns only the issuer-local pieces needed for opaque-token
/// checks: the authenticated OAuth client, accepted audiences, clock skew, and
/// successful-response cache. The raw bearer token never becomes a cache key or
/// debug value.
#[derive(Clone)]
pub(super) struct IntrospectionAuthority {
    client: Client,
    cache: Cache<TokenDigest, CachedPrincipal>,
    issuer: crate::Issuer,
    audiences: Vec<Audience>,
    clock_skew: Duration,
    max_lifetime: Duration,
}

impl std::fmt::Debug for IntrospectionAuthority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IntrospectionAuthority")
            .field("issuer", &self.issuer)
            .field("audiences", &self.audiences)
            .field("clock_skew", &self.clock_skew)
            .field("max_lifetime", &self.max_lifetime)
            .finish_non_exhaustive()
    }
}

impl IntrospectionAuthority {
    /// Builds an issuer-local introspection authority.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError`] when the OAuth client configuration cannot be
    /// represented by the typed `oauth2` client.
    pub(super) fn new(
        issuer: &IssuerConfig,
        cfg: &crate::IntrospectionConfig,
        endpoint: Url,
    ) -> Result<Self, AuthError> {
        let auth = match cfg.auth_method {
            crate::IntrospectionAuthMethod::ClientSecretBasic => oauth2::AuthType::BasicAuth,
            crate::IntrospectionAuthMethod::ClientSecretPost => oauth2::AuthType::RequestBody,
        };
        let client = oauth2::Client::new(oauth2::ClientId::new(cfg.client_id.as_str().to_owned()))
            .set_client_secret(oauth2::ClientSecret::new(
                cfg.client_secret.expose_secret().to_owned(),
            ))
            .set_auth_type(auth)
            .set_introspection_url(oauth2::IntrospectionUrl::from_url(endpoint));
        let cache = Cache::builder()
            .max_capacity(cfg.cache.max_capacity)
            .expire_after(PrincipalExpiry { ttl: cfg.cache.ttl })
            .build();
        Ok(Self {
            client,
            cache,
            issuer: issuer.issuer.clone(),
            audiences: issuer.audiences.clone(),
            clock_skew: issuer.clock_skew,
            max_lifetime: issuer.access_token.max_lifetime,
        })
    }

    /// Verifies one opaque bearer token and returns the typed caller.
    ///
    /// Successful responses are cached by a SHA-256 digest of the issuer and
    /// token. The cache entry never outlives the token's required `exp` claim.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError::InvalidToken`] when introspection says the token is
    /// inactive or when the returned claims do not match Canary's resource
    /// server policy. Network and protocol failures are returned as
    /// [`AuthError::Fetch`].
    pub(super) async fn verify(
        &self,
        client: &reqwest::Client,
        token: &crate::BearerToken,
    ) -> Result<Principal, AuthError> {
        let digest = TokenDigest::new(self.issuer.as_str(), token.as_str());
        if let Some(cached) = self.cache.get(&digest).await {
            return Ok(cached.principal);
        }
        let response = self
            .client
            .introspect(&oauth2::AccessToken::new(token.as_str().to_owned()))
            .set_token_type_hint("access_token")
            .request_async(client)
            .await
            .map_err(AuthError::fetch)?;
        let cached = self.principal(response)?;
        self.cache.insert(digest, cached.clone()).await;
        Ok(cached.principal)
    }

    fn principal(
        &self,
        value: oauth2::StandardTokenIntrospectionResponse<Extra, oauth2::basic::BasicTokenType>,
    ) -> Result<CachedPrincipal, AuthError> {
        if !value.active() {
            return Err(AuthError::invalid());
        }
        if let Some(issuer) = value.iss()
            && issuer != self.issuer.as_str()
        {
            return Err(AuthError::invalid());
        }
        let audiences = value.aud().ok_or_else(AuthError::invalid)?;
        let audiences = audiences
            .iter()
            .cloned()
            .map(Audience::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(AuthError::invalid_token)?;
        if !audiences.iter().any(|value| self.audiences.contains(value)) {
            return Err(AuthError::invalid());
        }
        let expires_at = timestamp(value.exp().ok_or_else(AuthError::invalid)?.timestamp())?;
        let issued_at = timestamp(value.iat().ok_or_else(AuthError::invalid)?.timestamp())?;
        validate_time(Some(expires_at), TimeClaim::Expiration, self.clock_skew)?;
        validate_time(
            value.nbf().map(|value| timestamp(value.timestamp())).transpose()?,
            TimeClaim::NotBefore,
            self.clock_skew,
        )?;
        validate_time(Some(issued_at), TimeClaim::IssuedAt, self.clock_skew)?;
        validate_token_lifetime(expires_at, issued_at, self.max_lifetime)?;

        let client_id = value.client_id().ok_or_else(AuthError::invalid)?;
        let client_id = ClientId::new(client_id.as_str()).map_err(AuthError::invalid_token)?;
        let (kind, subject) = match value.sub() {
            Some(subject) => {
                (PrincipalKind::User, Subject::new(subject).map_err(AuthError::invalid_token)?)
            }
            None => (
                PrincipalKind::Client,
                Subject::new(format!("client:{}", client_id.as_str()))
                    .map_err(AuthError::invalid_token)?,
            ),
        };

        let mut scopes = Vec::new();
        if let Some(values) = value.scopes() {
            scopes.extend(values.iter().map(|value| value.as_str().to_owned()));
        }
        if let Some(scp) = &value.extra_fields().scp {
            scp.extend_scopes(&mut scopes);
        }
        let principal = Principal::new_with_kind(
            kind,
            self.issuer.clone(),
            subject,
            client_id,
            audiences,
            ScopeSet::new(scopes).map_err(AuthError::invalid_token)?,
            RoleSet::new(value.extra_fields().roles.values()).map_err(AuthError::invalid_token)?,
            GroupSet::new(value.extra_fields().groups.values())
                .map_err(AuthError::invalid_token)?,
            EntitlementSet::new(value.extra_fields().entitlements.values())
                .map_err(AuthError::invalid_token)?,
        );
        Ok(CachedPrincipal { principal, expires_at })
    }
}

/// Cached active-token result with the token's own expiration.
#[derive(Clone)]
struct CachedPrincipal {
    principal: Principal,
    expires_at: u64,
}

/// Redacted cache key derived from the issuer and raw bearer token.
#[derive(Clone, PartialEq, Eq, Hash)]
struct TokenDigest([u8; 32]);

impl TokenDigest {
    #[inline(always)]
    fn new(issuer: &str, token: &str) -> Self {
        let mut hash = Sha256::new();
        hash.update(issuer.as_bytes());
        hash.update([0]);
        hash.update(token.as_bytes());
        Self(hash.finalize().into())
    }
}

impl std::fmt::Debug for TokenDigest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TokenDigest(\"***\")")
    }
}

/// Cache expiry policy that respects both Canary's TTL and token expiration.
#[derive(Clone, Copy)]
struct PrincipalExpiry {
    ttl: Duration,
}

impl Expiry<TokenDigest, CachedPrincipal> for PrincipalExpiry {
    fn expire_after_create(
        &self,
        _: &TokenDigest,
        value: &CachedPrincipal,
        _: Instant,
    ) -> Option<Duration> {
        let now = jsonwebtoken::get_current_timestamp();
        if value.expires_at <= now {
            return Some(Duration::ZERO);
        }
        Some(self.ttl.min(Duration::from_secs(value.expires_at - now)))
    }
}

/// Time-based introspection claim being checked.
#[derive(Debug, Clone, Copy)]
enum TimeClaim {
    Expiration,
    NotBefore,
    IssuedAt,
}

fn validate_time(
    value: Option<u64>,
    claim: TimeClaim,
    clock_skew: Duration,
) -> Result<(), AuthError> {
    let Some(value) = value else {
        return Ok(());
    };
    let now = jsonwebtoken::get_current_timestamp();
    match claim {
        TimeClaim::Expiration if value.saturating_add(clock_skew.as_secs()) < now => {
            Err(AuthError::invalid())
        }
        TimeClaim::NotBefore | TimeClaim::IssuedAt
            if value > now.saturating_add(clock_skew.as_secs()) =>
        {
            Err(AuthError::invalid())
        }
        _ => Ok(()),
    }
}

#[inline(always)]
fn timestamp(value: i64) -> Result<u64, AuthError> {
    u64::try_from(value).map_err(|_| AuthError::invalid())
}

/// Better Auth-friendly extension claims returned by introspection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Extra {
    #[serde(default)]
    scp: Option<ScopeClaim>,
    #[serde(default)]
    roles: ValuesClaim,
    #[serde(default)]
    groups: ValuesClaim,
    #[serde(default)]
    entitlements: ValuesClaim,
}

impl oauth2::ExtraTokenFields for Extra {}
