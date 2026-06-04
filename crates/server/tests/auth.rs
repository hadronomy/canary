mod common;

use std::time::Duration;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use canary_authorization::{
    Algorithm, Audience, Authorizer, BearerToken, EnabledConfig, Issuer, IssuerConfig,
    JsonWebKeySet, ProtectedResourceConfig, RefreshConfig, ResourceConfig, ResourceUri, ScopeSet,
};
use canary_server::files::service::FileService;
use canary_server::services::parser::ParserService;
use canary_server::{AppState, http};
use database::Database;
use jsonwebtoken::{Algorithm as JwtAlgorithm, EncodingKey, Header, encode};
use serde::Serialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use url::Url;

const ACCEPT: &str = "application/json, text/event-stream";
const VERSION: &str = "2025-11-25";
const ISSUER: &str = "https://issuer.example.com/";
const API: &str = "https://api.example.com/api";
const MCP: &str = "https://api.example.com/mcp";
const SECRET: &str = "1nk4304g9iJ904hpKLBYo4vL10HIx8QC0scYYpY7vSg";

#[tokio::test]
async fn protected_api_rejects_missing_bearer_token() {
    let app = app().await;
    let response = app
        .oneshot(Request::builder().uri("/v1/collections").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let challenge = response.headers().get(header::WWW_AUTHENTICATE).unwrap().to_str().unwrap();
    assert!(challenge.contains(
        "resource_metadata=\"https://api.example.com/.well-known/oauth-protected-resource/api\""
    ));
}

#[tokio::test]
async fn protected_api_accepts_valid_bearer_token() {
    let app = app().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/collections")
                .header(header::AUTHORIZATION, bearer(API, "canary:api:read"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn query_string_tokens_are_rejected() {
    let app = app().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/v1/collections?access_token=secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = body(response).await;
    assert_eq!(body["code"], "invalid_token");
}

#[tokio::test]
async fn metadata_routes_publish_protected_resources() {
    let app = app().await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-protected-resource/api")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let json = body(response).await;
    assert_eq!(json["resource"], API);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-protected-resource/mcp")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let json = body(response).await;
    assert_eq!(json["resource"], MCP);
    assert_eq!(json["bearer_methods_supported"], json!(["header"]));
}

#[tokio::test]
async fn mcp_session_does_not_replace_bearer_token() {
    let app = app().await;
    let response = mcp(
        &app,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "canary-test",
                    "version": "0.1.0"
                }
            }
        }),
        None,
        Some(&bearer(MCP, "canary:mcp:read")),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let session = response.headers().get("mcp-session-id").unwrap().to_str().unwrap().to_owned();

    let response = mcp(
        &app,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        Some(&session),
        None,
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

async fn app() -> Router {
    let cfg = common::config();
    let db = Database::connect(&cfg.settings.db).await.expect("db should connect");
    db.health().await.expect("db should be healthy");
    let files = FileService::new(cfg.settings.files.clone(), db.clone())
        .await
        .expect("files should initialize");
    let state = AppState::new(cfg, db, Some(authorizer()), ParserService::new(), files);
    state.update_db_ready();
    state.update_http_ready();
    http::router(&state, CancellationToken::new()).with_state(state)
}

fn authorizer() -> Authorizer {
    Authorizer::from_jwks(config(), vec![jwks()]).expect("authorizer should initialize")
}

fn config() -> EnabledConfig {
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
        vec![
            IssuerConfig::new(
                Issuer::parse(ISSUER).expect("issuer should validate"),
                Some(Url::parse("https://issuer.example.com/jwks").unwrap()),
                vec![Algorithm::Hs256],
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

fn jwks() -> JsonWebKeySet {
    serde_json::from_value(json!({
        "keys": [
            { "kty": "oct", "kid": "test", "alg": "HS256", "k": SECRET }
        ]
    }))
    .expect("JWKS should decode")
}

fn bearer(audience: &'static str, scope: &'static str) -> String {
    let jwt = encode(
        &header(),
        &claims(audience, scope),
        &EncodingKey::from_secret(&URL_SAFE_NO_PAD.decode(SECRET).expect("secret should decode")),
    )
    .expect("token should sign");
    format!("Bearer {}", BearerToken::new(jwt).unwrap().as_str())
}

fn claims(audience: &'static str, scope: &'static str) -> Claims {
    let issued_at = jsonwebtoken::get_current_timestamp();
    Claims {
        iss: ISSUER,
        sub: "user-123",
        aud: audience,
        exp: issued_at + 900,
        nbf: issued_at,
        scope: scope.to_owned(),
        client_id: "client-web".to_owned(),
        iat: issued_at,
        jti: "token-123".to_owned(),
    }
}

fn header() -> Header {
    let mut header = Header::new(JwtAlgorithm::HS256);
    header.typ = Some("at+jwt".to_owned());
    header.kid = Some("test".to_owned());
    header
}

async fn mcp(
    app: &Router,
    body: Value,
    session: Option<&str>,
    authorization: Option<&str>,
) -> axum::response::Response {
    let req = Request::builder()
        .method(Method::POST)
        .uri("/mcp")
        .header(header::HOST, "localhost")
        .header(header::ACCEPT, ACCEPT)
        .header(header::CONTENT_TYPE, "application/json");
    let req = match session {
        Some(session) => {
            req.header("mcp-session-id", session).header("mcp-protocol-version", VERSION)
        }
        None => req,
    };
    let req = match authorization {
        Some(value) => req.header(header::AUTHORIZATION, value),
        None => req,
    };
    app.clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .expect("router should respond")
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body should be readable");
    serde_json::from_slice(&bytes).expect("body should be valid json")
}

#[derive(Debug, Serialize)]
struct Claims {
    iss: &'static str,
    sub: &'static str,
    aud: &'static str,
    exp: u64,
    nbf: u64,
    scope: String,
    client_id: String,
    iat: u64,
    jti: String,
}
