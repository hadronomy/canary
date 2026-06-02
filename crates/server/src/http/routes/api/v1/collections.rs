use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collections", post(todo).get(todo))
        .route("/collections/{collection_id}", get(todo).patch(todo).delete(todo))
}
