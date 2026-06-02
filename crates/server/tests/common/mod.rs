#![allow(dead_code)]

use axum::Router;
use axum::body::to_bytes;
use canary_server::config::{
    S3AddressingStyle, S3Credentials, S3FileConfig, SecretString, TransportSecurity,
};
use canary_server::files::service::FileService;
use canary_server::services::parser::ParserService;
use canary_server::{AppState, LoadedConfig, ServerBuilder};
use database::Database;
use serde_json::Value;
use url::Url;

pub fn config() -> LoadedConfig {
    let mut cfg = LoadedConfig::default();
    cfg.settings.files.storage = S3FileConfig {
        bucket: "canary-test".into(),
        region: "us-east-1".into(),
        endpoint: Some(Url::parse("http://127.0.0.1:1").expect("test endpoint should be valid")),
        prefix: None,
        addressing_style: S3AddressingStyle::PathStyle,
        transport_security: TransportSecurity::AllowHttp,
        credentials: S3Credentials::Static {
            access_key_id: "test".into(),
            secret_access_key: SecretString::from("test".to_owned()),
            session_token: None,
        },
    };
    cfg
}

pub async fn app() -> Router {
    app_with(config()).await
}

pub async fn state() -> AppState {
    state_with(config()).await
}

pub async fn app_with(cfg: LoadedConfig) -> Router {
    ServerBuilder::new().with_config(cfg).build().await.expect("app should build").router()
}

pub async fn state_with(cfg: LoadedConfig) -> AppState {
    let db = Database::connect(&cfg.settings.db).await.expect("db should connect");
    db.health().await.expect("db should be healthy");
    let files = FileService::new(cfg.settings.files.clone(), db.clone())
        .await
        .expect("files should initialize");
    let state = AppState::new(cfg, db, ParserService::new(), files);
    state.update_db_ready();
    state.update_http_ready();
    state
}

pub fn request_id(response: &axum::response::Response) -> String {
    response
        .headers()
        .get("x-request-id")
        .expect("response should propagate x-request-id")
        .to_str()
        .expect("request id should be valid ascii")
        .to_owned()
}

pub async fn json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body should be readable");
    serde_json::from_slice(&bytes).expect("error body should be valid json")
}

pub fn actor(req: axum::http::request::Builder, actor: &str) -> axum::http::request::Builder {
    req.header("x-canary-actor-id", actor)
}
