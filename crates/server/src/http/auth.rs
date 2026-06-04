use axum::Router;
use axum::extract::{Request, State};
use axum::http::{Method, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use canary_authorization::{
    Action, AuthError, Authorizer, BearerToken, Challenge, Decision, Denial, Resource, ResourceUri,
};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
enum Protected {
    Api,
    Mcp,
}

#[derive(Clone)]
struct Guard {
    auth: Authorizer,
    resource: Resource,
    metadata: ResourceUri,
    protected: Protected,
}

#[inline(always)]
pub fn protect_api(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    protect(router, state, Protected::Api)
}

#[inline(always)]
pub fn protect_mcp(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    protect(router, state, Protected::Mcp)
}

fn protect(router: Router<AppState>, state: &AppState, protected: Protected) -> Router<AppState> {
    let Some(auth) = state.authorizer() else {
        return router;
    };
    let (resource, metadata) = match protected {
        Protected::Api => (Resource::api(), auth.api_metadata_uri()),
        Protected::Mcp => (Resource::mcp(), auth.mcp_metadata_uri()),
    };
    router.layer(middleware::from_fn_with_state(
        Guard { auth, resource, metadata, protected },
        require,
    ))
}

async fn require(State(guard): State<Guard>, mut request: Request, next: Next) -> Response {
    if has_query_token(request.uri().query()) {
        return response(AuthError::QueryToken, &guard.metadata);
    }
    let token = match BearerToken::from_headers(request.headers()) {
        Ok(token) => token,
        Err(err) => return response(AuthError::from(err), &guard.metadata),
    };
    let principal = match guard.auth.verify(&token).await {
        Ok(principal) => principal,
        Err(err) => return response(err, &guard.metadata),
    };
    let action = match guard.protected {
        Protected::Api => method_action(request.method()),
        Protected::Mcp => Action::Read,
    };
    match guard.auth.authorize(&principal, action, &guard.resource) {
        Decision::Allow => {
            request.extensions_mut().insert(principal);
            next.run(request).await
        }
        Decision::Deny(Denial::InsufficientScope { required }) => {
            response(AuthError::InsufficientScope { required }, &guard.metadata)
        }
        Decision::Deny(Denial::Containment) => {
            response(AuthError::InsufficientScope { required: Default::default() }, &guard.metadata)
        }
    }
}

fn response(error: AuthError, metadata: &ResourceUri) -> Response {
    let challenge = challenge(&error, metadata.clone());
    let mut response = app_error(&error).into_response();
    if let Ok(value) = challenge.to_header_value() {
        response.headers_mut().insert(header::WWW_AUTHENTICATE, value);
    }
    response
}

fn app_error(error: &AuthError) -> AppError {
    match error {
        AuthError::InsufficientScope { .. } => AppError::forbidden_code(
            "insufficient_scope",
            "The access token does not grant enough scope for this resource.",
        ),
        AuthError::Fetch { .. } => AppError::service_unavailable_code(
            "authorization_unavailable",
            "Authorization keys are currently unavailable.",
        ),
        AuthError::Config(_) => AppError::internal(
            "authorization_configuration_error",
            "The authorization configuration is invalid.",
        ),
        AuthError::QueryToken => AppError::unauthorized_code(
            "invalid_token",
            "Bearer tokens must be sent with the Authorization header.",
        ),
        AuthError::InvalidToken { .. } => {
            AppError::unauthorized_code("invalid_token", "The access token is invalid.")
        }
        AuthError::Bearer(_) | AuthError::Disabled => AppError::unauthorized_code(
            "unauthorized",
            "Authentication is required for this resource.",
        ),
    }
}

fn challenge(error: &AuthError, metadata: ResourceUri) -> Challenge {
    match error {
        AuthError::InsufficientScope { required } => {
            Challenge::insufficient_scope(required.clone(), Some(metadata))
        }
        AuthError::InvalidToken { .. } | AuthError::QueryToken => {
            Challenge::invalid_token(Some(metadata))
        }
        AuthError::Bearer(_) | AuthError::Disabled => Challenge::missing(Some(metadata)),
        AuthError::Fetch { .. } | AuthError::Config(_) => Challenge::invalid_token(Some(metadata)),
    }
}

fn method_action(method: &Method) -> Action {
    match *method {
        Method::GET | Method::HEAD => Action::Read,
        Method::POST => Action::Create,
        Method::PUT | Method::PATCH => Action::Update,
        Method::DELETE => Action::Delete,
        _ => Action::Read,
    }
}

fn has_query_token(query: Option<&str>) -> bool {
    query
        .into_iter()
        .flat_map(|query| query.split('&'))
        .filter_map(|part| part.split_once('=').map(|(key, _)| key).or(Some(part)))
        .any(|key| key == "access_token")
}
