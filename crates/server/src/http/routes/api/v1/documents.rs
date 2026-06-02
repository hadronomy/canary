use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collections/{collection_id}/documents", post(todo).get(todo))
        .route(
            "/collections/{collection_id}/documents/{document_id}",
            get(todo).patch(todo).delete(todo),
        )
        .route("/collections/{collection_id}/documents/{document_id}/versions", get(todo))
        .route(
            "/collections/{collection_id}/documents/{document_id}/versions/{version_id}",
            get(todo),
        )
        .route("/collections/{collection_id}/documents/{document_id}/chunks", get(todo))
        .route("/collections/{collection_id}/chunks/{chunk_id}", get(todo))
}
