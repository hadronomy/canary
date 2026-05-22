use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::state::{AppState, ReadinessSnapshot};

pub fn router() -> Router<AppState> {
    Router::new().route("/healthz", get(health)).route("/readyz", get(readiness))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct HealthResponse {
    service: &'static str,
    version: &'static str,
    started_at: chrono::DateTime<chrono::Utc>,
    #[serde(with = "humantime_serde")]
    uptime: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ReadinessResponse {
    service: &'static str,
    version: &'static str,
    readiness: ReadinessSnapshot,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        service: env!("CARGO_PKG_NAME"),
        version: env!("CARGO_PKG_VERSION"),
        started_at: state.started_at(),
        uptime: state.uptime(),
    })
}

async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<ReadinessResponse>) {
    let readiness = state.readiness_snapshot();
    let status =
        if readiness.is_ready() { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (
        status,
        Json(ReadinessResponse {
            service: env!("CARGO_PKG_NAME"),
            version: env!("CARGO_PKG_VERSION"),
            readiness,
        }),
    )
}
