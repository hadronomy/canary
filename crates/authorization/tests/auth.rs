use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use canary_authorization::{
    Action, Algorithm, Audience, AuthError, Authorizer, BearerToken, Challenge, Decision,
    EnabledConfig, Issuer, IssuerConfig, JsonWebKeySet, ProtectedResourceConfig,
    RawAccessTokenConfig, RawIssuerConfig, RefreshConfig, Resource, ResourceConfig, ResourceUri,
    ScopeSet,
};
#[cfg(feature = "introspection")]
use canary_authorization::{
    ClientId, IntrospectionAuthMethod, IntrospectionCacheConfig, IntrospectionConfig,
    PrincipalKind, TokenFormat, TokenFormatSet,
};
use http::HeaderMap;
use http::header::AUTHORIZATION;
use jsonwebtoken::{Algorithm as JwtAlgorithm, EncodingKey, Header, encode};
#[cfg(feature = "introspection")]
use secrecy::SecretString;
use serde::Serialize;
use serde_json::json;
#[cfg(feature = "introspection")]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use url::Url;

const ISSUER: &str = "https://issuer.example.com/";
const API: &str = "https://api.example.com/api";
const MCP: &str = "https://api.example.com/mcp";
const SECRET: &str = "1nk4304g9iJ904hpKLBYo4vL10HIx8QC0scYYpY7vSg";
const RSA_N: &str = "yRE6rHuNR0QbHO3H3Kt2pOKGVhQqGZXInOduQNxXzuKlvQTLUTv4l4sggh5_CYYi_cvI-SXVT9kPWSKXxJXBXd_4LkvcPuUakBoAkfh-eiFVMh2VrUyWyj3MFl0HTVF9KwRXLAcwkREiS3npThHRyIxuy0ZMeZfxVL5arMhw1SRELB8HoGfG_AtH89BIE9jDBHZ9dLelK9a184zAf8LwoPLxvJb3Il5nncqPcSfKDDodMFBIMc4lQzDKL5gvmiXLXB1AGLm8KBjfE8s3L5xqi-yUod-j8MtvIj812dkS4QMiRVN_by2h3ZY8LYVGrqZXZTcgn2ujn8uKjXLZVD5TdQ";
const ED_X: &str = "2-Jj2UvNCvQiUPNYRgSi0cJSPiJI6Rs6D0UTeEpQVj8";
const EC_X: &str = "w7JAoU_gJbZJvV-zCOvU9yFJq0FNC_edCMRM78P8eQQ";
const EC_Y: &str = "wQg1EytcsEmGrM70Gb53oluoDbVhCZ3Uq3hHMslHVb4";
const RSA_PRIVATE: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDJETqse41HRBsc
7cfcq3ak4oZWFCoZlcic525A3FfO4qW9BMtRO/iXiyCCHn8JhiL9y8j5JdVP2Q9Z
IpfElcFd3/guS9w+5RqQGgCR+H56IVUyHZWtTJbKPcwWXQdNUX0rBFcsBzCRESJL
eelOEdHIjG7LRkx5l/FUvlqsyHDVJEQsHwegZ8b8C0fz0EgT2MMEdn10t6Ur1rXz
jMB/wvCg8vG8lvciXmedyo9xJ8oMOh0wUEgxziVDMMovmC+aJctcHUAYubwoGN8T
yzcvnGqL7JSh36Pwy28iPzXZ2RLhAyJFU39vLaHdljwthUaupldlNyCfa6Ofy4qN
ctlUPlN1AgMBAAECggEAdESTQjQ70O8QIp1ZSkCYXeZjuhj081CK7jhhp/4ChK7J
GlFQZMwiBze7d6K84TwAtfQGZhQ7km25E1kOm+3hIDCoKdVSKch/oL54f/BK6sKl
qlIzQEAenho4DuKCm3I4yAw9gEc0DV70DuMTR0LEpYyXcNJY3KNBOTjN5EYQAR9s
2MeurpgK2MdJlIuZaIbzSGd+diiz2E6vkmcufJLtmYUT/k/ddWvEtz+1DnO6bRHh
xuuDMeJA/lGB/EYloSLtdyCF6sII6C6slJJtgfb0bPy7l8VtL5iDyz46IKyzdyzW
tKAn394dm7MYR1RlUBEfqFUyNK7C+pVMVoTwCC2V4QKBgQD64syfiQ2oeUlLYDm4
CcKSP3RnES02bcTyEDFSuGyyS1jldI4A8GXHJ/lG5EYgiYa1RUivge4lJrlNfjyf
dV230xgKms7+JiXqag1FI+3mqjAgg4mYiNjaao8N8O3/PD59wMPeWYImsWXNyeHS
55rUKiHERtCcvdzKl4u35ZtTqQKBgQDNKnX2bVqOJ4WSqCgHRhOm386ugPHfy+8j
m6cicmUR46ND6ggBB03bCnEG9OtGisxTo/TuYVRu3WP4KjoJs2LD5fwdwJqpgtHl
yVsk45Y1Hfo+7M6lAuR8rzCi6kHHNb0HyBmZjysHWZsn79ZM+sQnLpgaYgQGRbKV
DZWlbw7g7QKBgQCl1u+98UGXAP1jFutwbPsx40IVszP4y5ypCe0gqgon3UiY/G+1
zTLp79GGe/SjI2VpQ7AlW7TI2A0bXXvDSDi3/5Dfya9ULnFXv9yfvH1QwWToySpW
Kvd1gYSoiX84/WCtjZOr0e0HmLIb0vw0hqZA4szJSqoxQgvF22EfIWaIaQKBgQCf
34+OmMYw8fEvSCPxDxVvOwW2i7pvV14hFEDYIeZKW2W1HWBhVMzBfFB5SE8yaCQy
pRfOzj9aKOCm2FjjiErVNpkQoi6jGtLvScnhZAt/lr2TXTrl8OwVkPrIaN0bG/AS
aUYxmBPCpXu3UjhfQiWqFq/mFyzlqlgvuCc9g95HPQKBgAscKP8mLxdKwOgX8yFW
GcZ0izY/30012ajdHY+/QK5lsMoxTnn0skdS+spLxaS5ZEO4qvPVb8RAoCkWMMal
2pOhmquJQVDPDLuZHdrIiKiDM20dy9sMfHygWcZjQ4WSxf/J7T9canLZIXFhHAZT
3wc9h4G8BBCtWN2TN/LsGZdB
-----END PRIVATE KEY-----"#;
const EC_PRIVATE: &str = r#"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWTFfCGljY6aw3Hrt
kHmPRiazukxPLb6ilpRAewjW8nihRANCAATDskChT+Altkm9X7MI69T3IUmrQU0L
950IxEzvw/x5BMEINRMrXLBJhqzO9Bm+d6JbqA21YQmd1Kt4RzLJR1W+
-----END PRIVATE KEY-----"#;
const ED_PRIVATE: &[u8] = &[
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    0x6a, 0xc3, 0xfd, 0xee, 0xee, 0x29, 0x8a, 0x92, 0x63, 0x8b, 0x70, 0x0c, 0x4b, 0x11, 0x7c, 0xc3,
    0x2e, 0x2d, 0x2a, 0xce, 0x0d, 0xfd, 0x78, 0x76, 0x94, 0xe2, 0x4c, 0xae, 0x8a, 0xd5, 0x82, 0x34,
];

#[test]
fn challenge_renders_bearer_header() {
    let resource =
        ResourceUri::parse("https://api.example.com/api").expect("resource URI should validate");
    let challenge = Challenge::insufficient_scope(
        ScopeSet::new(["canary:api:read"]).expect("scope should validate"),
        Some(resource.metadata_uri()),
    );

    assert_eq!(
        challenge.to_string(),
        "Bearer error=\"insufficient_scope\" error_description=\"The access token does not grant enough scope.\" scope=\"canary:api:read\" resource_metadata=\"https://api.example.com/.well-known/oauth-protected-resource/api\""
    );
}

#[test]
fn resource_uri_rejects_fragments() {
    let err = ResourceUri::parse("https://api.example.com/api#frag").unwrap_err();

    assert_eq!(err.to_string(), "resource URLs must not contain fragments");
}

#[test]
fn scope_set_rejects_non_scope_token_characters() {
    for value in ["bad scope", "bad\"scope", "bad\\scope", "ámbito"] {
        assert!(ScopeSet::new([value]).is_err());
    }
}

#[test]
fn jwks_debug_redacts_key_material() {
    let debug = format!("{:?}", hmac_jwks());

    assert!(debug.contains("***"));
    assert!(!debug.contains(SECRET));
}

#[test]
fn raw_access_token_config_defaults_to_fifteen_minutes() {
    let cfg = IssuerConfig::try_from(raw_issuer()).expect("issuer config should validate");

    assert_eq!(cfg.access_token.max_lifetime, Duration::from_secs(15 * 60));
}

#[test]
fn raw_access_token_config_accepts_custom_lifetime() {
    let mut raw = raw_issuer();
    raw.access_token = RawAccessTokenConfig { max_lifetime: Duration::from_secs(5 * 60) };

    let cfg = IssuerConfig::try_from(raw).expect("issuer config should validate");

    assert_eq!(cfg.access_token.max_lifetime, Duration::from_secs(5 * 60));
}

#[test]
fn raw_access_token_config_rejects_zero_lifetime() {
    let mut raw = raw_issuer();
    raw.access_token = RawAccessTokenConfig { max_lifetime: Duration::ZERO };

    let err = IssuerConfig::try_from(raw).expect_err("zero lifetime should be rejected");

    assert_eq!(
        err.to_string(),
        "auth.issuers[].access_token.max_lifetime must be greater than zero"
    );
}

#[test]
fn bearer_token_parses_typed_authorization_header() {
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, "Bearer opaque-token".parse().unwrap());

    let token = BearerToken::from_headers(&headers).expect("bearer token should parse");

    assert_eq!(token.as_str(), "opaque-token");
}

#[test]
fn bearer_token_rejects_malformed_authorization_header() {
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, "Basic nope".parse().unwrap());

    assert!(BearerToken::from_headers(&headers).is_err());
}

#[tokio::test]
async fn verifies_valid_jwt_claims() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts::default());

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.issuer().as_str(), ISSUER);
    assert_eq!(principal.subject().as_str(), "user-123");
    assert_eq!(principal.client_id().as_str(), "client-web");
    assert_eq!(principal.audiences().len(), 1);
    assert!(principal.has_scope("canary:api:read"));
    assert!(principal.roles().contains("maintainer"));
}

#[tokio::test]
async fn accepts_audience_arrays() {
    let auth = hmac_authorizer();
    let token =
        token(TokenOpts { audience: AudienceValue::Many(vec![API, MCP]), ..Default::default() });

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.audiences().len(), 2);
}

#[tokio::test]
async fn verifies_eddsa_access_tokens() {
    let auth = Authorizer::from_jwks(config(vec![Algorithm::EdDsa]), vec![eddsa_jwks()])
        .expect("authorizer should initialize");
    let token =
        token(TokenOpts { alg: JwtAlgorithm::EdDSA, kid: Some("ed01"), ..Default::default() });

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.client_id().as_str(), "client-web");
}

#[tokio::test]
async fn verifies_rs256_access_tokens() {
    let auth = Authorizer::from_jwks(config(vec![Algorithm::Rs256]), vec![rsa_jwks()])
        .expect("authorizer should initialize");
    let token =
        token(TokenOpts { alg: JwtAlgorithm::RS256, kid: Some("rsa01"), ..Default::default() });

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.subject().as_str(), "user-123");
}

#[tokio::test]
async fn verifies_es256_access_tokens() {
    let auth = Authorizer::from_jwks(config(vec![Algorithm::Es256]), vec![ecdsa_jwks()])
        .expect("authorizer should initialize");
    let token =
        token(TokenOpts { alg: JwtAlgorithm::ES256, kid: Some("ec01"), ..Default::default() });

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.subject().as_str(), "user-123");
}

#[tokio::test]
async fn rejects_wrong_audience() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts {
        audience: AudienceValue::One("https://api.example.com/other"),
        ..Default::default()
    });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_missing_access_token_type() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { typ: None, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_missing_key_id() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { kid: None, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_unknown_key_id() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { kid: Some("other"), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_unsupported_algorithm() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { alg: JwtAlgorithm::HS384, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_expired_tokens() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { expires_at: 1, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn accepts_access_tokens_at_max_lifetime() {
    let now = jsonwebtoken::get_current_timestamp();
    let auth = hmac_authorizer();
    let token =
        token(TokenOpts { expires_at: now + 900, issued_at: Some(now), ..Default::default() });

    assert!(auth.verify(&token).await.is_ok());
}

#[tokio::test]
async fn rejects_access_tokens_exceeding_max_lifetime() {
    let now = jsonwebtoken::get_current_timestamp();
    let auth = hmac_authorizer();
    let token =
        token(TokenOpts { expires_at: now + 901, issued_at: Some(now), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_access_tokens_expiring_before_issued_at() {
    let now = jsonwebtoken::get_current_timestamp();
    let auth = hmac_authorizer();
    let token =
        token(TokenOpts { expires_at: now + 20, issued_at: Some(now + 30), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_missing_client_id() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { client_id: None, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_missing_issued_at() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { issued_at: None, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_future_issued_at() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { issued_at: Some(u64::MAX), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_missing_jwt_id() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { jwt_id: None, ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn accepts_missing_not_before() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { not_before: None, ..Default::default() });

    assert!(auth.verify(&token).await.is_ok());
}

#[tokio::test]
async fn rejects_future_not_before() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { not_before: Some(u64::MAX), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_invalid_scope_claims() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { scope: Some("bad\\scope"), ..Default::default() });

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[tokio::test]
async fn rejects_duplicate_key_selectors() {
    let jwks = keyset(json!({
        "keys": [
            { "kty": "oct", "kid": "test", "alg": "HS256", "k": SECRET },
            { "kty": "oct", "kid": "test", "alg": "HS256", "k": SECRET }
        ]
    }));

    assert!(Authorizer::from_jwks(config(vec![Algorithm::Hs256]), vec![jwks]).is_err());
}

#[tokio::test]
async fn rejects_jwk_algorithm_mismatch() {
    let jwks = keyset(json!({
        "keys": [
            { "kty": "oct", "kid": "test", "alg": "RS256", "k": SECRET }
        ]
    }));

    assert!(Authorizer::from_jwks(config(vec![Algorithm::Rs256]), vec![jwks]).is_err());
}

#[tokio::test]
async fn authorizes_scope_permissions() {
    let auth = hmac_authorizer();
    let principal = auth.verify(&token(TokenOpts::default())).await.expect("token should verify");

    assert_eq!(auth.authorize(&principal, Action::Read, &Resource::api()), Decision::Allow);
    assert!(matches!(
        auth.authorize(&principal, Action::Delete, &Resource::api()),
        Decision::Deny(_)
    ));
}

#[tokio::test]
async fn authorizes_admin_scope() {
    let auth = hmac_authorizer();
    let token = token(TokenOpts { scope: Some("canary:admin"), ..Default::default() });
    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(auth.authorize(&principal, Action::Delete, &Resource::api()), Decision::Allow);
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn verifies_opaque_user_tokens_with_introspection() {
    let (issued_at, expires_at) = token_times();
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "iss": ISSUER,
        "sub": "user-123",
        "aud": [API],
        "exp": expires_at,
        "iat": issued_at,
        "client_id": "client-web",
        "scope": "canary:api:read",
        "roles": ["maintainer"],
        "groups": ["legal"],
        "entitlements": ["retrieval"]
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("opaque-user-token").expect("token should validate");

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.kind(), PrincipalKind::User);
    assert_eq!(principal.subject().as_str(), "user-123");
    assert_eq!(principal.client_id().as_str(), "client-web");
    assert!(principal.has_scope("canary:api:read"));
    assert!(principal.roles().contains("maintainer"));
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn verifies_opaque_client_tokens_without_subject() {
    let (issued_at, expires_at) = token_times();
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "aud": API,
        "exp": expires_at,
        "iat": issued_at,
        "client_id": "worker",
        "scope": "canary:api:read"
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("opaque-client-token").expect("token should validate");

    let principal = auth.verify(&token).await.expect("token should verify");

    assert_eq!(principal.kind(), PrincipalKind::Client);
    assert_eq!(principal.subject().as_str(), "client:worker");
    assert_eq!(principal.client_id().as_str(), "worker");
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn rejects_opaque_tokens_exceeding_max_lifetime() {
    let issued_at = jsonwebtoken::get_current_timestamp();
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "aud": API,
        "exp": issued_at + 901,
        "iat": issued_at,
        "client_id": "worker",
        "scope": "canary:api:read"
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("opaque-long-token").expect("token should validate");

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn rejects_opaque_tokens_without_expiration() {
    let issued_at = jsonwebtoken::get_current_timestamp();
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "aud": API,
        "iat": issued_at,
        "client_id": "worker",
        "scope": "canary:api:read"
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("opaque-no-exp-token").expect("token should validate");

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn rejects_opaque_tokens_without_issued_at() {
    let expires_at = jsonwebtoken::get_current_timestamp() + 900;
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "aud": API,
        "exp": expires_at,
        "client_id": "worker",
        "scope": "canary:api:read"
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("opaque-no-iat-token").expect("token should validate");

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

#[cfg(feature = "introspection")]
#[tokio::test]
async fn jwt_shaped_malformed_tokens_do_not_use_introspection() {
    let (issued_at, expires_at) = token_times();
    let endpoint = introspection_endpoint(json!({
        "active": true,
        "aud": API,
        "exp": expires_at,
        "iat": issued_at,
        "client_id": "worker",
        "scope": "canary:api:read"
    }))
    .await;
    let auth = Authorizer::from_config(opaque_config(endpoint))
        .await
        .expect("authorizer should initialize");
    let token = BearerToken::new("a.b.c").expect("token should validate");

    assert!(matches!(auth.verify(&token).await, Err(AuthError::InvalidToken { .. })));
}

fn hmac_authorizer() -> Authorizer {
    Authorizer::from_jwks(config(vec![Algorithm::Hs256]), vec![hmac_jwks()])
        .expect("authorizer should initialize")
}

fn raw_issuer() -> RawIssuerConfig {
    RawIssuerConfig {
        issuer: Some(Url::parse(ISSUER).expect("url should parse")),
        jwks_uri: Some(Url::parse("https://issuer.example.com/jwks").expect("url should parse")),
        audiences: vec![API.to_owned()],
        ..Default::default()
    }
}

fn config(algorithms: Vec<Algorithm>) -> EnabledConfig {
    EnabledConfig::new(
        ResourceConfig {
            api: ProtectedResourceConfig {
                resource: ResourceUri::parse(API).expect("api resource should validate"),
                scopes_supported: ScopeSet::new([
                    "canary:api:read",
                    "canary:api:delete",
                    "canary:admin",
                ])
                .expect("scopes should validate"),
            },
            mcp: ProtectedResourceConfig {
                resource: ResourceUri::parse(MCP).expect("mcp resource should validate"),
                scopes_supported: ScopeSet::new(["canary:mcp:read"])
                    .expect("scopes should validate"),
            },
        },
        vec![
            IssuerConfig::new(
                Issuer::parse(ISSUER).expect("issuer should validate"),
                Some(Url::parse("https://issuer.example.com/jwks").unwrap()),
                algorithms,
                vec![
                    Audience::new(API).expect("audience should validate"),
                    Audience::new(MCP).expect("audience should validate"),
                ],
                Duration::from_secs(60),
                RefreshConfig::default(),
            )
            .expect("issuer config should validate"),
        ],
    )
    .expect("config should validate")
}

#[cfg(feature = "introspection")]
fn opaque_config(endpoint: Url) -> EnabledConfig {
    let mut issuer = IssuerConfig::new(
        Issuer::parse(ISSUER).expect("issuer should validate"),
        None,
        vec![Algorithm::Hs256],
        vec![
            Audience::new(API).expect("audience should validate"),
            Audience::new(MCP).expect("audience should validate"),
        ],
        Duration::from_secs(60),
        RefreshConfig::default(),
    )
    .expect("issuer config should validate");
    issuer.token_formats =
        TokenFormatSet::new([TokenFormat::Opaque]).expect("format should validate");
    issuer.introspection = Some(IntrospectionConfig {
        endpoint: Some(endpoint),
        client_id: ClientId::new("resource-server").expect("client id should validate"),
        client_secret: SecretString::from("resource-secret".to_owned()),
        auth_method: IntrospectionAuthMethod::ClientSecretBasic,
        cache: IntrospectionCacheConfig::default(),
    });
    EnabledConfig::new(
        ResourceConfig {
            api: ProtectedResourceConfig {
                resource: ResourceUri::parse(API).expect("api resource should validate"),
                scopes_supported: ScopeSet::new(["canary:api:read"])
                    .expect("scopes should validate"),
            },
            mcp: ProtectedResourceConfig {
                resource: ResourceUri::parse(MCP).expect("mcp resource should validate"),
                scopes_supported: ScopeSet::new(["canary:mcp:read"])
                    .expect("scopes should validate"),
            },
        },
        vec![issuer],
    )
    .expect("config should validate")
}

#[cfg(feature = "introspection")]
async fn introspection_endpoint(body: serde_json::Value) -> Url {
    let listener =
        tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.expect("listener should bind");
    let addr = listener.local_addr().expect("listener address should be available");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("request should arrive");
        let mut buf = [0_u8; 4096];
        let len = stream.read(&mut buf).await.expect("request should read");
        let req = String::from_utf8_lossy(&buf[..len]);
        assert!(req.starts_with("POST /introspect "));
        assert!(
            req.contains("Authorization: Basic cmVzb3VyY2Utc2VydmVyOnJlc291cmNlLXNlY3JldA==")
                || req
                    .contains("authorization: Basic cmVzb3VyY2Utc2VydmVyOnJlc291cmNlLXNlY3JldA==")
        );
        let body = body.to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(response.as_bytes()).await.expect("response should write");
    });
    Url::parse(&format!("http://{addr}/introspect")).expect("url should parse")
}

fn hmac_jwks() -> JsonWebKeySet {
    keyset(json!({
        "keys": [
            { "kty": "oct", "kid": "test", "alg": "HS256", "k": SECRET }
        ]
    }))
}

fn eddsa_jwks() -> JsonWebKeySet {
    keyset(json!({
        "keys": [
            { "kty": "OKP", "use": "sig", "crv": "Ed25519", "x": ED_X, "kid": "ed01", "alg": "EdDSA" }
        ]
    }))
}

fn rsa_jwks() -> JsonWebKeySet {
    keyset(json!({
        "keys": [
            { "kty": "RSA", "use": "sig", "n": RSA_N, "e": "AQAB", "kid": "rsa01", "alg": "RS256" }
        ]
    }))
}

fn ecdsa_jwks() -> JsonWebKeySet {
    keyset(json!({
        "keys": [
            { "kty": "EC", "use": "sig", "crv": "P-256", "x": EC_X, "y": EC_Y, "kid": "ec01", "alg": "ES256" }
        ]
    }))
}

fn keyset(value: serde_json::Value) -> JsonWebKeySet {
    serde_json::from_value(value).expect("JWKS should decode")
}

fn token(opts: TokenOpts) -> BearerToken {
    let key = match opts.alg {
        JwtAlgorithm::EdDSA => EncodingKey::from_ed_der(ED_PRIVATE),
        JwtAlgorithm::RS256 => {
            EncodingKey::from_rsa_pem(RSA_PRIVATE.as_bytes()).expect("RSA key should decode")
        }
        JwtAlgorithm::ES256 => {
            EncodingKey::from_ec_pem(EC_PRIVATE.as_bytes()).expect("ECDSA key should decode")
        }
        _ => {
            EncodingKey::from_secret(&URL_SAFE_NO_PAD.decode(SECRET).expect("secret should decode"))
        }
    };
    let jwt = encode(&opts.header(), &claims(opts), &key).expect("token should sign");
    BearerToken::new(jwt).expect("token should validate")
}

fn claims(opts: TokenOpts) -> Claims {
    Claims {
        iss: ISSUER,
        sub: "user-123",
        aud: opts.audience,
        exp: opts.expires_at,
        nbf: opts.not_before,
        scope: opts.scope,
        client_id: opts.client_id,
        iat: opts.issued_at,
        jti: opts.jwt_id,
        roles: vec!["maintainer"],
        groups: vec!["legal"],
        entitlements: vec!["retrieval"],
    }
}

#[derive(Debug, Clone)]
struct TokenOpts {
    alg: JwtAlgorithm,
    typ: Option<&'static str>,
    kid: Option<&'static str>,
    audience: AudienceValue,
    expires_at: u64,
    client_id: Option<&'static str>,
    issued_at: Option<u64>,
    jwt_id: Option<&'static str>,
    not_before: Option<u64>,
    scope: Option<&'static str>,
}

impl Default for TokenOpts {
    fn default() -> Self {
        let issued_at = jsonwebtoken::get_current_timestamp();
        Self {
            alg: JwtAlgorithm::HS256,
            typ: Some("at+jwt"),
            kid: Some("test"),
            audience: AudienceValue::One(API),
            expires_at: issued_at + 900,
            client_id: Some("client-web"),
            issued_at: Some(issued_at),
            jwt_id: Some("token-123"),
            not_before: None,
            scope: Some("canary:api:read"),
        }
    }
}

impl TokenOpts {
    fn header(&self) -> Header {
        let mut header = Header::new(self.alg);
        header.typ = self.typ.map(str::to_owned);
        header.kid = self.kid.map(str::to_owned);
        header
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum AudienceValue {
    One(&'static str),
    Many(Vec<&'static str>),
}

#[derive(Debug, Serialize)]
struct Claims {
    iss: &'static str,
    sub: &'static str,
    aud: AudienceValue,
    exp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    nbf: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_id: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    iat: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    jti: Option<&'static str>,
    roles: Vec<&'static str>,
    groups: Vec<&'static str>,
    entitlements: Vec<&'static str>,
}

#[cfg(feature = "introspection")]
#[inline(always)]
fn token_times() -> (u64, u64) {
    let issued_at = jsonwebtoken::get_current_timestamp();
    (issued_at, issued_at + 900)
}
