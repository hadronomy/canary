mod common;

use std::env;

use axum::http::{Request, StatusCode, header};
use base64::Engine;
use canary_server::config::{
    FileBackendConfig, ObjectPrefix, S3AddressingStyle, S3Credentials, S3FileConfig,
    TransportSecurity,
};
use common::{actor, app_with, json};
use crc64fast_nvme::Digest as Crc64;
use reqwest::Client;
use serde_json::json as json_value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use url::Url;
use uuid::Uuid;

struct RustFsEnv {
    endpoint: Url,
    bucket: String,
    region: String,
    addressing_style: S3AddressingStyle,
}

impl RustFsEnv {
    fn load() -> Self {
        let endpoint = env::var("CANARY_RUSTFS_ENDPOINT")
            .ok()
            .and_then(|value| Url::parse(&value).ok())
            .expect("CANARY_RUSTFS_ENDPOINT should be a valid URL");
        let bucket = env::var("CANARY_RUSTFS_BUCKET").expect("CANARY_RUSTFS_BUCKET should exist");
        let region = env::var("CANARY_RUSTFS_REGION").unwrap_or_else(|_| "us-east-1".to_owned());
        let addressing_style = if env::var("CANARY_RUSTFS_PATH_STYLE")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(true)
        {
            S3AddressingStyle::PathStyle
        } else {
            S3AddressingStyle::VirtualHosted
        };
        Self { endpoint, bucket, region, addressing_style }
    }
}

fn rustfs_cfg(dir: &tempfile::TempDir, rustfs: &RustFsEnv) -> canary_server::LoadedConfig {
    let mut cfg = common::config(dir);
    cfg.settings.files.backend = FileBackendConfig::S3(Box::new(S3FileConfig {
        bucket: rustfs.bucket.clone().into(),
        region: rustfs.region.clone().into(),
        endpoint: Some(rustfs.endpoint.clone()),
        prefix: Some(
            ObjectPrefix::new(format!("tests/{}", Uuid::new_v4()))
                .expect("object prefix should be valid"),
        ),
        addressing_style: rustfs.addressing_style,
        transport_security: if rustfs.endpoint.scheme() == "http" {
            TransportSecurity::AllowHttp
        } else {
            TransportSecurity::HttpsOnly
        },
        credentials: S3Credentials::Ambient,
    }));
    cfg.settings.files.uploads.multipart_threshold_bytes = 5 * 1024 * 1024;
    cfg.settings.files.uploads.multipart_part_size_bytes = 5 * 1024 * 1024;
    cfg.settings.files.uploads.multipart_max_parts = 32;
    cfg
}

fn put(req: reqwest::RequestBuilder, headers: &[serde_json::Value]) -> reqwest::RequestBuilder {
    headers.iter().fold(req, |req, header| {
        req.header(
            header["name"].as_str().expect("header name should exist"),
            header["value"].as_str().expect("header value should exist"),
        )
    })
}

fn sha256(data: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(data);
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn crc64(data: &[u8]) -> String {
    let mut hash = Crc64::new();
    hash.write(data);
    base64::engine::general_purpose::STANDARD.encode(hash.sum64().to_be_bytes())
}

#[tokio::test]
#[ignore = "requires CANARY_RUSTFS_* environment and ambient AWS-style credentials"]
async fn rustfs_direct_put_roundtrip() {
    let rustfs = RustFsEnv::load();
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app_with(rustfs_cfg(&dir, &rustfs)).await;
    let http = Client::new();

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
                    "sha256": sha256(b"hello"),
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
    assert_eq!(created["upload"]["kind"], "direct_put");
    assert_eq!(created["upload"]["checksum"]["algorithm"], "sha256");
    assert_eq!(created["upload"]["checksum"]["kind"], "full_object");

    let upload = put(
        http.put(created["upload"]["url"].as_str().expect("signed upload url should exist")),
        created["upload"]["headers"].as_array().expect("signed headers should exist"),
    )
    .body("hello".to_owned())
    .send()
    .await
    .expect("direct put should send");
    assert!(upload.status().is_success());

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
    assert_eq!(blob["size_bytes"], 5);
    assert_eq!(blob["checksum"]["algorithm"], "sha256");
    assert_eq!(blob["checksum"]["verifier"], "storage");
}

#[tokio::test]
#[ignore = "requires CANARY_RUSTFS_* environment and ambient AWS-style credentials"]
async fn rustfs_direct_multipart_roundtrip() {
    let rustfs = RustFsEnv::load();
    let dir = tempfile::tempdir().expect("temp dir should create");
    let app = app_with(rustfs_cfg(&dir, &rustfs)).await;
    let http = Client::new();
    let part = vec![b'a'; 5 * 1024 * 1024];
    let first_sum = crc64(&part);
    let second_sum = crc64(b"b");
    let full_sum = crc64(&[part.as_slice(), b"b"].concat());

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
                    "name": "large.bin",
                    "content_type": "application/octet-stream",
                    "size_bytes": part.len() + 1,
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
    assert_eq!(created["upload"]["kind"], "direct_multipart");
    assert_eq!(created["upload"]["checksum"]["algorithm"], "crc64_nvme");
    assert_eq!(created["upload"]["checksum"]["kind"], "full_object");

    let response = app
        .clone()
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/files/uploads/{id}/parts"))
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "parts": [
                        { "number": 1, "checksum": first_sum },
                        { "number": 2, "checksum": second_sum }
                    ]
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let signed = json(response).await;
    let parts = signed["parts"].as_array().expect("signed parts should exist");
    assert_eq!(parts.len(), 2);

    let first = put(
        http.put(parts[0]["url"].as_str().expect("part url should exist")),
        parts[0]["headers"].as_array().expect("part headers should exist"),
    )
    .body(part.clone())
    .send()
    .await
    .expect("multipart part should send");
    assert!(first.status().is_success());

    let second = put(
        http.put(parts[1]["url"].as_str().expect("part url should exist")),
        parts[1]["headers"].as_array().expect("part headers should exist"),
    )
    .body(vec![b'b'])
    .send()
    .await
    .expect("multipart part should send");
    assert!(second.status().is_success());

    let response = app
        .oneshot(
            actor(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/files/uploads/{id}/complete"))
                    .header(header::CONTENT_TYPE, "application/json"),
                "alice",
            )
            .body(axum::body::Body::from(
                json_value!({
                    "parts": [
                        {
                            "number": 1,
                            "checksum": first_sum,
                            "etag": first
                                .headers()
                                .get(header::ETAG)
                                .and_then(|value| value.to_str().ok())
                                .expect("etag should exist"),
                        },
                        {
                            "number": 2,
                            "checksum": second_sum,
                            "etag": second
                                .headers()
                                .get(header::ETAG)
                                .and_then(|value| value.to_str().ok())
                                .expect("etag should exist"),
                        }
                    ],
                    "checksum": full_sum
                })
                .to_string(),
            ))
            .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let blob = json(response).await;
    assert_eq!(blob["id"], id);
    assert_eq!(blob["size_bytes"], part.len() as u64 + 1);
    assert_eq!(blob["checksum"]["algorithm"], "crc64_nvme");
    assert_eq!(blob["checksum"]["kind"], "full_object");
    assert_eq!(blob["checksum"]["verifier"], "storage");
}
