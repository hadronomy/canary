use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/operations/{operation_id}", get(todo))
        .route("/operations/{operation_id}/cancel", post(todo))
}
