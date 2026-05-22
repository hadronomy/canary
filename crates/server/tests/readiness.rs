use axum::body::Body;
use axum::http::{Request, StatusCode};
use canary_server::{LoadedConfig, ServerBuilder};
use tower::ServiceExt;

#[tokio::test]
async fn readyz_returns_deep_ready_status() {
    let app = ServerBuilder::new()
        .with_config(LoadedConfig::default())
        .build()
        .await
        .expect("app should build");

    let response = app
        .router()
        .oneshot(Request::builder().uri("/readyz").body(Body::empty()).unwrap())
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
