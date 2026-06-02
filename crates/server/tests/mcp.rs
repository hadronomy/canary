mod common;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use axum::response::Response;
use canary_server::CollectionId;
use serde_json::{Value, json};
use tower::ServiceExt;

const ACCEPT: &str = "application/json, text/event-stream";
const VERSION: &str = "2025-11-25";

#[tokio::test]
async fn mcp_exposes_curated_surface_and_structured_stubs() {
    let app = common::app().await;
    let response = post(
        &app,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "canary-test",
                    "version": "0.1.0"
                }
            }
        }),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let session = response
        .headers()
        .get("mcp-session-id")
        .expect("initialize should create a session")
        .to_str()
        .expect("session id should be ascii")
        .to_owned();
    let body = sse(response).await;
    assert!(body["result"]["capabilities"]["tools"].is_object());
    assert!(body["result"]["capabilities"]["prompts"].is_object());
    assert!(body["result"]["capabilities"]["resources"].is_object());

    let response = post(
        &app,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }),
        Some(&session),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    let body = sse(post(
        &app,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        Some(&session),
    )
    .await)
    .await;
    let tools = names(&body["result"]["tools"]);
    assert_eq!(tools.len(), 11);
    assert!(tools.contains(&"search_collection"));
    assert!(tools.contains(&"ingest_text"));
    assert!(tools.contains(&"run_source_sync"));

    let body = sse(post(
        &app,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "prompts/list" }),
        Some(&session),
    )
    .await)
    .await;
    let prompts = names(&body["result"]["prompts"]);
    assert_eq!(prompts.len(), 4);
    assert!(prompts.contains(&"answer_with_sources"));
    assert!(prompts.contains(&"investigate_ingestion_failure"));

    let body = sse(post(
        &app,
        json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/templates/list" }),
        Some(&session),
    )
    .await)
    .await;
    assert_eq!(body["result"]["resourceTemplates"].as_array().unwrap().len(), 7);

    let body = sse(post(
        &app,
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "search_collection",
                "arguments": {
                    "collection_id": CollectionId::new().public(),
                    "query": "shutdown coordinator"
                }
            }
        }),
        Some(&session),
    )
    .await)
    .await;
    assert_eq!(body["error"]["code"], -32603);
    assert_eq!(body["error"]["data"]["code"], "not_implemented");
    assert_eq!(body["error"]["data"]["operation"], "search_collection");

    let response = delete(&app, &session).await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
}

#[tokio::test]
async fn mcp_rejects_untrusted_browser_origins() {
    let app = common::app().await;
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/mcp")
                .header(header::HOST, "localhost")
                .header(header::ORIGIN, "https://untrusted.example")
                .header(header::ACCEPT, ACCEPT)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": VERSION,
                            "capabilities": {},
                            "clientInfo": {
                                "name": "canary-test",
                                "version": "0.1.0"
                            }
                        }
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

async fn post(app: &Router, body: Value, session: Option<&str>) -> Response {
    let req = Request::builder()
        .method(Method::POST)
        .uri("/mcp")
        .header(header::HOST, "localhost")
        .header(header::ACCEPT, ACCEPT)
        .header(header::CONTENT_TYPE, "application/json");
    let req = match session {
        Some(session) => {
            req.header("mcp-session-id", session).header("mcp-protocol-version", VERSION)
        }
        None => req,
    };
    app.clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .expect("router should respond")
}

async fn delete(app: &Router, session: &str) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri("/mcp")
                .header(header::HOST, "localhost")
                .header("mcp-session-id", session)
                .header("mcp-protocol-version", VERSION)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("router should respond")
}

async fn sse(response: Response) -> Value {
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.expect("body should be readable");
    let body = str::from_utf8(&body).expect("SSE body should be UTF-8");
    let data = body
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("data:").map(str::trim))
        .expect("SSE body should carry JSON-RPC data");
    serde_json::from_str(data).expect("SSE data should be valid JSON")
}

fn names(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .expect("list result should be an array")
        .iter()
        .map(|value| value["name"].as_str().expect("listed item should have a name"))
        .collect()
}
