pub mod context;
pub mod extract;
pub mod middleware;
pub mod response;
pub mod routes;

use axum::Router;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::state::AppState;

async fn not_found() -> AppError {
    AppError::not_found("The requested resource was not found.")
}

async fn method_not_allowed() -> AppError {
    AppError::method_not_allowed("The requested method is not allowed for this resource.")
}

/// Builds the complete HTTP surface with streaming-safe middleware around MCP.
pub fn router(state: &AppState, token: CancellationToken) -> Router<AppState> {
    let rest = middleware::rest(
        Router::new().merge(routes::system::router()).merge(routes::api::router(state)),
        state,
    );
    let router = Router::new()
        .merge(routes::mcp::router(state, token))
        .merge(rest)
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found);
    middleware::shared(router, state)
}
