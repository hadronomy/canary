mod common;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::routing::get;
use canary_server::{AppError, FileId, http};
use common::{app, json, request_id, state};
use serde_json::Value;
use tower::ServiceExt;

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
    let id = FileId::new();
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

    assert_common(&body, "file_not_found", "The requested file was not found.", 404, &request_id);
    assert_eq!(body["title"], "Resource not found");
    assert_eq!(body["context"]["file_id"], Value::String(id.to_string()));
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
