use axum::Router;
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

/// Mounts Canary's curated MCP surface at `/mcp`.
#[inline(always)]
pub fn router(state: &AppState, token: CancellationToken) -> Router<AppState> {
    crate::mcp::transport::router(state, token)
}
