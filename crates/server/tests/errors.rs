use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::routing::get;
use canary_server::config::StoragePath;
use canary_server::db::service::DatabaseService;
use canary_server::files::service::FileService;
use canary_server::services::parser::ParserService;
use canary_server::{AppError, AppState, LoadedConfig, ServerBuilder, http};
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn config(dir: &TempDir) -> LoadedConfig {
    let mut cfg = LoadedConfig::default();
    cfg.settings.files.root = StoragePath::new(dir.path()).expect("temp path should be valid");
    cfg
}

async fn app(dir: &TempDir) -> Router {
    ServerBuilder::new().with_config(config(dir)).build().await.expect("app should build").router()
}

async fn state(dir: &TempDir) -> AppState {
    let cfg = config(dir);
    let db = DatabaseService::connect(&cfg.settings.db).await.expect("db should connect");
    db.health().await.expect("db should be healthy");
    let files =
        FileService::new(cfg.settings.files.clone()).await.expect("files should initialize");
    let state = AppState::new(cfg, db, ParserService::new(), files);
    state.update_db_ready();
    state.update_http_ready();
    state
}

fn request_id(response: &axum::response::Response) -> String {
    response
        .headers()
        .get("x-request-id")
        .expect("response should propagate x-request-id")
        .to_str()
        .expect("request id should be valid ascii")
        .to_owned()
}

async fn json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body should be readable");
    serde_json::from_slice(&bytes).expect("error body should be valid json")
}

fn multipart(boundary: &str, name: &str, file: &str, ty: &str, body: &str) -> Vec<u8> {
    format!(
        "--{boundary}\r\ncontent-disposition: form-data; name=\"{name}\"; filename=\"{file}\"\r\ncontent-type: {ty}\r\n\r\n{body}\r\n--{boundary}--\r\n"
    )
    .into_bytes()
}

fn assert_common(body: &Value, code: &str, message: &str, status: u16, request_id: &str) {
    assert_eq!(body["type"], format!("/problems/{code}"));
    assert_eq!(body["detail"], message);
    assert_eq!(body["status"], status);
    assert_eq!(body["code"], code);
    assert_eq!(body["request_id"], request_id);
    assert_eq!(body["instance"], format!("urn:canary:request:{request_id}"));
}

#[tokio::test]
async fn domain_errors_use_stable_error_shape() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let id = Uuid::new_v4();
    let response = app(&dir)
        .await
        .oneshot(
            Request::builder().uri(format!("/api/v1/files/{id}/meta")).body(Body::empty()).unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers().get(header::CONTENT_TYPE).unwrap(), "application/problem+json");

    let request_id = request_id(&response);
    let body = json(response).await;

    assert_common(&body, "blob_not_found", "The requested blob was not found.", 404, &request_id);
    assert_eq!(body["title"], "Resource not found");
    assert_eq!(body["context"]["blob_id"], Value::String(id.to_string()));
}

#[tokio::test]
async fn internal_errors_use_generic_error_shape() {
    async fn boom() -> Result<(), AppError> {
        Err(AppError::internal(
            "internal_test_error",
            "The server encountered an unexpected internal error.",
        ))
    }

    let dir = tempfile::tempdir().expect("temp dir should create");
    let state = state(&dir).await;
    let app =
        http::middleware::apply(Router::new().route("/boom", get(boom)), &state).with_state(state);
    let response = app
        .oneshot(Request::builder().uri("/boom").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let request_id = request_id(&response);
    let body = json(response).await;

    assert_common(
        &body,
        "internal_test_error",
        "The server encountered an unexpected internal error.",
        500,
        &request_id,
    );
    assert_eq!(body["title"], "Internal server error");
}

#[tokio::test]
async fn unknown_routes_use_not_found_fallback() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let response = app(&dir)
        .await
        .oneshot(Request::builder().uri("/missing").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let request_id = request_id(&response);
    let body = json(response).await;

    assert_common(&body, "not_found", "The requested resource was not found.", 404, &request_id);
    assert_eq!(body["title"], "Resource not found");
}

#[tokio::test]
async fn pagination_validation_uses_consistent_error_shape() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let response = app(&dir)
        .await
        .oneshot(Request::builder().uri("/api/v1/files?limit=1001").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let request_id = request_id(&response);
    let body = json(response).await;

    assert_common(
        &body,
        "invalid_pagination",
        "The pagination query is invalid.",
        422,
        &request_id,
    );
    assert_eq!(body["title"], "Request validation failed");
    assert_eq!(body["context"]["reason"], "page limit must not exceed 1000");
}

#[tokio::test]
async fn method_not_allowed_uses_consistent_error_shape() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let response = app(&dir)
        .await
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/parse/document")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

    let request_id = request_id(&response);
    let body = json(response).await;

    assert_common(
        &body,
        "method_not_allowed",
        "The requested method is not allowed for this resource.",
        405,
        &request_id,
    );
    assert_eq!(body["title"], "Method not allowed");
}

#[tokio::test]
async fn multipart_upload_persists_and_can_be_read_back() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;
    let boundary = "canary-boundary";
    let body = multipart(boundary, "file", "hello.txt", "text/plain", "hello from multipart");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files")
                .header(header::CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(response.headers().get(header::CONTENT_TYPE).unwrap(), "application/json");

    let created = json(response).await;
    let id = created["id"].as_str().expect("created response should contain blob id");

    let response = app
        .oneshot(
            Request::builder().uri(format!("/api/v1/files/{id}/meta")).body(Body::empty()).unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let meta = json(response).await;
    assert_eq!(meta["id"], id);
    assert_eq!(meta["name"], "hello.txt");
    assert_eq!(meta["media_type"], "text/plain");
    assert_eq!(meta["size_bytes"], 20);
}
