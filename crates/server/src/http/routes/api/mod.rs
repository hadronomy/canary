pub mod v1;

use axum::Router;

use crate::state::AppState;

pub fn router(state: &AppState) -> Router<AppState> {
    let router = v1::router(state);
    Router::new().nest("/v1", router.clone()).nest("/api/v1", router)
}
