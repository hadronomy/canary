#![allow(dead_code)]

use axum::Router;
use axum::body::to_bytes;
use canary_server::config::{FileBackendConfig, LocalFileConfig, StoragePath};
use canary_server::files::service::FileService;
use canary_server::services::parser::ParserService;
use canary_server::{AppState, LoadedConfig, ServerBuilder};
use database::Database;
use serde_json::Value;
use tempfile::TempDir;

pub fn config(dir: &TempDir) -> LoadedConfig {
    let mut cfg = LoadedConfig::default();
    let root = dir.path().join("blobs");
    cfg.settings.files.backend = FileBackendConfig::Local(LocalFileConfig {
        root: StoragePath::new(&root).expect("temp path should be valid"),
    });
    cfg
}

pub async fn app(dir: &TempDir) -> Router {
    app_with(config(dir)).await
}

pub async fn state(dir: &TempDir) -> AppState {
    state_with(config(dir)).await
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
