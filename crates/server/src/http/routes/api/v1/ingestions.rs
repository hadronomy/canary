use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collections/{collection_id}/ingestions", post(todo).get(todo))
        .route("/collections/{collection_id}/ingestions/{ingestion_id}", get(todo))
        .route("/collections/{collection_id}/ingestions/{ingestion_id}/cancel", post(todo))
        .route("/collections/{collection_id}/ingestions/{ingestion_id}/events", get(todo))
}
