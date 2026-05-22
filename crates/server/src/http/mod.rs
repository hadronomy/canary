pub mod extract;
pub mod middleware;
pub mod response;
pub mod routes;

use axum::Router;

use crate::state::AppState;

pub fn router(state: &AppState) -> Router<AppState> {
    let router = Router::new().merge(routes::system::router()).merge(routes::api::router());
    middleware::apply(router, state)
}
