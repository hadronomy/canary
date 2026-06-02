mod common;

use axum::http::{Request, StatusCode, header};
use common::{app, json, request_id};
use serde_json::json as json_value;
use tower::ServiceExt;

fn assert_problem(
    body: &serde_json::Value,
    code: &str,
    detail: &str,
    status: u16,
    request_id: &str,
) {
    assert_eq!(body["type"], format!("/problems/{code}"));
    assert_eq!(body["detail"], detail);
    assert_eq!(body["status"], status);
    assert_eq!(body["code"], code);
    assert_eq!(body["request_id"], request_id);
}

#[tokio::test]
async fn upload_intent_requires_actor() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files/uploads")
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    json_value!({
                        "name": "hello.txt",
                        "content_type": "text/plain",
                        "size_bytes": 5,
                        "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                        "purpose": "attachment"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let rid = request_id(&response);
    let body = json(response).await;
    assert_problem(
        &body,
        "upload_unauthorized",
        "Authentication is required for uploads.",
        401,
        &rid,
    );
}
