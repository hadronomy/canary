use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::header::{AUTHORIZATION, COOKIE};
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
use crate::state::AppState;

async fn handle_middleware_error(error: BoxError) -> impl IntoResponse {
    AppError::from_box_error(error)
}

pub fn apply(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    let settings = &state.loaded_config().settings;
    router.layer(DefaultBodyLimit::max(settings.server.max_body_size_bytes)).layer(
        ServiceBuilder::new()
            .layer(axum::error_handling::HandleErrorLayer::new(handle_middleware_error))
            .layer(TimeoutLayer::new(settings.server.request_timeout))
            .layer(SetSensitiveHeadersLayer::new([AUTHORIZATION, COOKIE]))
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
            .layer(
                TraceLayer::new_for_http()
                    .on_request(DefaultOnRequest::new().level(Level::DEBUG))
                    .on_response(DefaultOnResponse::new().level(Level::DEBUG))
                    .on_failure(DefaultOnFailure::new().level(Level::WARN)),
            )
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(CatchPanicLayer::new())
            .layer(CompressionLayer::new()),
    )
}
