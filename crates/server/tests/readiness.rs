mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::app;
use tower::ServiceExt;

#[tokio::test]
async fn readyz_returns_deep_ready_status() {
    let app = app().await;

    let response = app
        .oneshot(Request::builder().uri("/readyz").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
