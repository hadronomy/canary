use axum::Router;
use axum::routing::post;

use crate::http::routes::todo::todo;
use crate::state::AppState;

#[inline(always)]
pub fn router() -> Router<AppState> {
    Router::new().route("/collections/{collection_id}/search", post(todo))
}
