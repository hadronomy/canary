mod common;

use axum::extract::FromRef;
use axum::http::{Request, StatusCode, header};
use canary_server::{DbState, FileService, http};
use common::{actor, app, json, request_id, state};
use futures_util::StreamExt;
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
    let dir = tempfile::tempdir().expect("temp dir should create");
    let response = app(&dir)
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

#[tokio::test]
async fn upload_status_and_events_start_from_created_state() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");
    assert_eq!(created["status"], "created");
    assert_eq!(created["upload"]["kind"], "proxy_put");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder().method("GET").uri(format!("/api/v1/files/uploads/{id}")),
                "alice",
            )
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let status = json(response).await;
    assert_eq!(status["status"], "created");
    assert_eq!(status["strategy"], "proxy_put");
    assert_eq!(status["size_bytes"], 5);

    let response = app
        .oneshot(
            actor(
                Request::builder().method("GET").uri(format!("/api/v1/files/uploads/{id}/events")),
                "alice",
            )
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers().get(header::CONTENT_TYPE).unwrap(), "text/event-stream");

    let mut stream = response.into_body().into_data_stream();
    let chunk =
        stream.next().await.expect("sse should produce data").expect("sse chunk should be valid");
    let text = String::from_utf8(chunk.to_vec()).expect("sse should be utf-8");
    assert!(text.contains("event: upload.snapshot"));
    assert!(text.contains(r#""status":"created""#));
}

#[tokio::test]
async fn proxy_upload_rejects_body_larger_than_intent() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .oneshot(
            actor(
                Request::builder().method("PUT").uri(format!("/api/v1/files/uploads/{id}/content")),
                "alice",
            )
            .body(axum::body::Body::from("hello world"))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let rid = request_id(&response);
    let body = json(response).await;
    assert_problem(
        &body,
        "upload_too_large",
        "The upload exceeds the configured size limit.",
        413,
        &rid,
    );
}

#[tokio::test]
async fn upload_flow_completes_and_exposes_blob() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder().method("PUT").uri(format!("/api/v1/files/uploads/{id}/content")),
                "alice",
            )
            .body(axum::body::Body::from("hello"))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let uploaded = json(response).await;
    assert_eq!(uploaded["status"], "uploaded");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/files/uploads/{id}/complete"))
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from("{}"))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let blob = json(response).await;
    assert_eq!(blob["id"], id);
    assert_eq!(blob["name"], "hello.txt");
    assert_eq!(blob["size_bytes"], 5);
    assert_eq!(blob["media_type"], "text/plain");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder().method("GET").uri(format!("/api/v1/files/uploads/{id}")),
                "alice",
            )
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let status = json(response).await;
    assert_eq!(status["status"], "ready");

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{id}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let bytes =
        axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body should read");
    assert_eq!(bytes, "hello");
}

#[tokio::test]
async fn ready_blob_metadata_survives_service_rebuild() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let state = state(&dir).await;
    let app = http::router(&state).with_state(state.clone());

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder().method("PUT").uri(format!("/api/v1/files/uploads/{id}/content")),
                "alice",
            )
            .body(axum::body::Body::from("hello"))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::ACCEPTED);

    let response = app
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/files/uploads/{id}/complete"))
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from("{}"))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let cfg = state.loaded_config().clone();
    let db = DbState::from_ref(&state).db;
    let files =
        FileService::new(cfg.settings.files.clone(), db).await.expect("files should rebuild");
    let blob = files
        .blobs()
        .head(id.parse().expect("blob id should parse"))
        .await
        .expect("ready blob metadata should persist");

    assert_eq!(blob.id.to_string(), id);
    assert_eq!(blob.name.as_ref().map(|name| name.as_str()), Some("hello.txt"));
    assert_eq!(blob.size.get(), 5);
    assert_eq!(blob.kind.effective.as_str(), "text/plain");

    let page = files
        .list(canary_server::Limit::new(10).expect("limit should be valid"))
        .page()
        .await
        .expect("blob listing should read from durable metadata");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, id);
}

#[tokio::test]
async fn multipart_parts_endpoint_rejects_proxy_uploads() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/files/uploads/{id}/parts"))
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(json_value!({ "parts": [1] }).to_string()))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let rid = request_id(&response);
    let body = json(response).await;
    assert_problem(
        &body,
        "upload_invalid_state",
        "The upload is not in a valid state for this operation.",
        422,
        &rid,
    );
}

#[tokio::test]
async fn access_refresh_rejects_proxy_uploads() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .oneshot(
            actor(
                Request::builder().method("POST").uri(format!("/api/v1/files/uploads/{id}/access")),
                "alice",
            )
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let rid = request_id(&response);
    let body = json(response).await;
    assert_problem(
        &body,
        "upload_invalid_state",
        "The upload is not in a valid state for this operation.",
        422,
        &rid,
    );
}

#[tokio::test]
async fn abort_marks_proxy_upload_deleted() {
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app(&dir).await;

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files/uploads")
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "name": "hello.txt",
                    "content_type": "text/plain",
                    "size_bytes": 5,
                    "purpose": "attachment"
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    let created = json(response).await;
    let id = created["id"].as_str().expect("id should be present");

    let response = app
        .oneshot(
            actor(
                Request::builder().method("POST").uri(format!("/api/v1/files/uploads/{id}/abort")),
                "alice",
            )
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let body = json(response).await;
    assert_eq!(body["status"], "deleted");
}
