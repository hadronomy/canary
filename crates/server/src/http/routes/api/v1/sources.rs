use axum::Router;
use axum::routing::{get, post};

use crate::http::routes::todo::todo;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collections/{collection_id}/sources", post(todo).get(todo))
        .route(
            "/collections/{collection_id}/sources/{source_id}",
            get(todo).patch(todo).delete(todo),
        )
        .route("/collections/{collection_id}/sources/{source_id}/runs", post(todo).get(todo))
        .route("/collections/{collection_id}/sources/{source_id}/runs/{run_id}", get(todo))
        .route("/collections/{collection_id}/sources/{source_id}/runs/{run_id}/cancel", post(todo))
}
