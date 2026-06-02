mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::app;
use tower::ServiceExt;

#[tokio::test]
async fn healthz_returns_ok() {
    let app = app().await;

    let response = app
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn livez_returns_no_content() {
    let app = app().await;

    let response = app
        .oneshot(Request::builder().uri("/livez").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}
