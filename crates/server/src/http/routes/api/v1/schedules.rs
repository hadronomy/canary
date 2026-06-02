use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/schedules", post(todo).get(todo))
        .route("/schedules/{schedule_id}", get(todo).patch(todo).delete(todo))
        .route("/schedules/{schedule_id}/pause", post(todo))
        .route("/schedules/{schedule_id}/resume", post(todo))
        .route("/schedules/{schedule_id}/trigger", post(todo))
        .route("/schedules/{schedule_id}/runs", get(todo))
}
