//! Axum transport adapter for Canary's MCP server.
//!
//! The transport stays separate from ordinary REST routing because stateful
//! MCP sessions may keep SSE streams open beyond the REST request timeout.

use axum::Router;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use tokio_util::sync::CancellationToken;

use crate::mcp::Mcp;
use crate::state::AppState;

/// Mounts the stateful MCP Streamable HTTP service at `/mcp`.
///
/// A new [`Mcp`] handler is created for each logical client session. The
/// returned router accepts `POST` and `GET` transport requests and handles
/// `DELETE` session termination through `rmcp`.
pub fn router(state: &AppState, token: CancellationToken) -> Router<AppState> {
    let mcp = &state.loaded_config().settings.mcp;
    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(mcp.allowed_hosts.iter().cloned())
        .with_allowed_origins(mcp.allowed_origins.iter().cloned())
        .with_sse_keep_alive(Some(mcp.sse_keep_alive))
        .with_sse_retry(Some(mcp.sse_retry))
        .with_cancellation_token(token);
    let state = state.clone();
    let service = StreamableHttpService::new(
        move || Ok(Mcp::new(state.clone())),
        LocalSessionManager::default().into(),
        config,
    );
    Router::new().nest_service("/mcp", service)
}
