use std::any::Any;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::middleware::from_fn;
use axum::response::IntoResponse;
use tower::timeout::TimeoutLayer;
use tower::{BoxError, ServiceBuilder};
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::compression::CompressionLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::sensitive_headers::SetSensitiveHeadersLayer;
use tower_http::trace::{DefaultOnFailure, DefaultOnRequest, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::error::AppError;
use crate::http::context::bind_request_context;
use crate::state::AppState;

async fn handle_middleware_error(error: BoxError) -> impl IntoResponse {
    AppError::from_box_error(error)
}

fn handle_panic(_: Box<dyn Any + Send + 'static>) -> axum::response::Response {
    AppError::internal("panic", "The server encountered an unexpected internal error.")
        .into_response()
}

/// Applies both shared and REST-specific middleware to a finite HTTP subtree.
#[inline(always)]
pub fn apply(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    shared(rest(router, state), state)
}

/// Applies middleware that is safe for ordinary responses and long-lived MCP streams.
pub fn shared(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    let settings = &state.loaded_config().settings;
    router.layer(DefaultBodyLimit::max(settings.server.max_body_size_bytes)).layer(
        ServiceBuilder::new()
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
            .layer(from_fn(bind_request_context))
            .layer(SetSensitiveHeadersLayer::new([AUTHORIZATION, COOKIE]))
            .layer(
                TraceLayer::new_for_http()
                    .on_request(DefaultOnRequest::new().level(Level::DEBUG))
                    .on_response(DefaultOnResponse::new().level(Level::DEBUG))
                    .on_failure(DefaultOnFailure::new().level(Level::WARN)),
            )
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(CatchPanicLayer::custom(handle_panic)),
    )
}

/// Applies middleware for finite REST responses.
///
/// MCP streams deliberately skip this layer because response compression and a
/// whole-response timeout are not appropriate for long-lived SSE connections.
pub fn rest(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    let settings = &state.loaded_config().settings;
    router.layer(
        ServiceBuilder::new()
            .layer(axum::error_handling::HandleErrorLayer::new(handle_middleware_error))
            .layer(TimeoutLayer::new(settings.server.request_timeout))
            .layer(CompressionLayer::new()),
    )
}
