use axum::extract::State;
use axum::http::Uri;
use axum::routing::get;
use axum::{Json, Router};
use canary_authorization::{Authorizer, ProtectedResourceMetadata};

use crate::error::{AppError, AppResult};
use crate::state::AuthState;

pub fn router() -> Router<crate::AppState> {
    Router::new()
        .route("/.well-known/oauth-protected-resource", get(metadata))
        .route("/.well-known/oauth-protected-resource/{*path}", get(metadata))
}

async fn metadata(
    State(state): State<AuthState>,
    uri: Uri,
) -> AppResult<Json<ProtectedResourceMetadata>> {
    let auth = state
        .auth
        .ok_or_else(|| AppError::not_found("Authorization metadata is not available."))?;
    metadata_for(&auth, uri.path())
        .map(Json)
        .ok_or_else(|| AppError::not_found("Authorization metadata is not available."))
}

fn metadata_for(auth: &Authorizer, path: &str) -> Option<ProtectedResourceMetadata> {
    if auth.api_metadata_uri().as_url().path() == path {
        return Some(auth.api_metadata());
    }
    if auth.mcp_metadata_uri().as_url().path() == path {
        return Some(auth.mcp_metadata());
    }
    None
}
