//! Small HTTP extractors layered on top of the core server types.

use std::marker::PhantomData;
use std::ops::Deref;

use axum::body::{Body, Bytes};
use axum::extract::{FromRef, FromRequest, FromRequestParts, Query};
use axum::http::HeaderMap;
use axum::http::header::HeaderName;
use axum::http::request::Parts;
use public_id::{PublicId, ResourceId};
use serde_json::json;

use crate::error::AppError;
use crate::files::upload::ActorId;
use crate::pagination::{
    DefaultPagePolicy, Limit, PagePolicy, PagePolicySource, PageQuery, PageWindow,
};
use crate::state::AppState;

const ACTOR_HEADER: HeaderName = HeaderName::from_static("x-canary-actor-id");

/// Axum extractor for validated pagination state.
///
/// This extractor:
///
/// - deserializes a shared [`PageQuery`] from the query string
/// - applies configured defaults and optional bounds
/// - decodes the optional wire cursor into the domain cursor type
/// - yields a validated [`PageWindow`]-shaped value to the handler
///
/// It is designed to keep handlers focused on domain logic rather than query
/// parsing and limit validation.
///
/// `C` is the domain cursor type seen by the handler. `W` is the wire cursor
/// type deserialized from the query string and defaults to `C`. When the API
/// boundary uses typed wrappers such as [`PublicId<T>`], `W` can stay public
/// while `C` stays domain-shaped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pagination<C, P = DefaultPagePolicy, W = C> {
    window: PageWindow<C>,
    marker: PhantomData<(P, W)>,
}

impl<C, P, W> Pagination<C, P, W> {
    #[must_use]
    pub fn after(&self) -> Option<&C> {
        self.window.after()
    }

    #[must_use]
    pub fn limit(&self) -> Limit {
        self.window.limit()
    }

    #[must_use]
    pub fn window(&self) -> &PageWindow<C> {
        &self.window
    }

    #[must_use]
    pub fn into_window(self) -> PageWindow<C> {
        self.window
    }
}

impl<C, P, W> From<PageWindow<C>> for Pagination<C, P, W> {
    fn from(window: PageWindow<C>) -> Self {
        Self { window, marker: PhantomData }
    }
}

impl<C, P, W> From<Pagination<C, P, W>> for PageWindow<C> {
    fn from(value: Pagination<C, P, W>) -> Self {
        value.window
    }
}

/// Decodes a pagination cursor from its wire representation into the domain
/// cursor type consumed by handlers and services.
pub trait PageCursor<W>: Sized {
    /// Converts one wire cursor into its domain form.
    fn decode_cursor(wire: W) -> Result<Self, AppError>;
}

impl<T> PageCursor<T> for T {
    fn decode_cursor(wire: T) -> Result<Self, AppError> {
        Ok(wire)
    }
}

impl<T: ResourceId> PageCursor<PublicId<T>> for T {
    fn decode_cursor(wire: PublicId<T>) -> Result<Self, AppError> {
        Ok(wire.into_inner())
    }
}

impl<S> PagePolicySource<S> for DefaultPagePolicy
where
    S: Send + Sync,
    PagePolicy: FromRef<S>,
{
    fn policy(state: &S) -> PagePolicy {
        PagePolicy::from_ref(state)
    }
}

impl<S, C, P, W> FromRequestParts<S> for Pagination<C, P, W>
where
    S: Send + Sync,
    P: PagePolicySource<S>,
    C: Clone + PageCursor<W> + Send + Sync + 'static,
    W: Clone + Send + Sync + 'static,
    PageQuery<W>: serde::de::DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let query = Query::<PageQuery<W>>::from_request_parts(parts, state)
            .await
            .map_err(AppError::from)?;
        let query = PageQuery::new()
            .with_after(query.0.after().cloned().map(C::decode_cursor).transpose()?)
            .with_limit(query.0.limit());
        let window = P::policy(state).resolve(query).map_err(|err| {
            AppError::validation_code("invalid_pagination", "The pagination query is invalid.")
                .with_detail("reason", json!(err.to_string()))
        })?;
        Ok(Self { window, marker: PhantomData })
    }
}

impl FromRef<AppState> for PagePolicy {
    fn from_ref(state: &AppState) -> Self {
        state.loaded_config().settings.http.pagination.clone()
    }
}

/// Request body bytes with custom [`AppError`] rejection handling.
#[derive(Debug, Clone)]
pub struct RequestBytes(Bytes);

impl RequestBytes {
    #[must_use]
    pub fn into_vec(self) -> Vec<u8> {
        self.0.to_vec()
    }
}

impl Deref for RequestBytes {
    type Target = Bytes;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<S> FromRequest<S> for RequestBytes
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: axum::extract::Request, state: &S) -> Result<Self, Self::Rejection> {
        Bytes::from_request(req, state).await.map(Self).map_err(AppError::from)
    }
}

pub fn optional_mime(headers: &HeaderMap) -> Option<mime::Mime> {
    headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<mime::Mime>().ok())
}

pub fn into_body_stream(body: Body) -> Body {
    body
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadActor(ActorId);

impl UploadActor {
    #[must_use]
    pub fn into_inner(self) -> ActorId {
        self.0
    }
}

impl AsRef<ActorId> for UploadActor {
    fn as_ref(&self) -> &ActorId {
        &self.0
    }
}

impl Deref for UploadActor {
    type Target = ActorId;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<S> FromRequestParts<S> for UploadActor
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let Some(value) = parts.headers.get(&ACTOR_HEADER) else {
            return Err(AppError::unauthorized_code(
                "upload_unauthorized",
                "Authentication is required for uploads.",
            ));
        };
        let value = value.to_str().map_err(|_| {
            AppError::unauthorized_code(
                "upload_unauthorized",
                "Authentication is required for uploads.",
            )
        })?;
        let actor = ActorId::new(value).map_err(|_| {
            AppError::unauthorized_code(
                "upload_unauthorized",
                "Authentication is required for uploads.",
            )
        })?;
        Ok(Self(actor))
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::extract::{FromRef, FromRequestParts};
    use http::Request;
    use public_id::{PublicId, resource_id};

    use super::Pagination;
    use crate::pagination::{DefaultPagePolicy, Limit, PagePolicy, PagePolicySource};

    resource_id!(TestId, "test");

    #[derive(Clone)]
    struct TestState {
        cfg: PagePolicy,
    }

    impl FromRef<TestState> for PagePolicy {
        fn from_ref(state: &TestState) -> Self {
            state.cfg.clone()
        }
    }

    #[derive(Debug)]
    struct Tight;

    impl PagePolicySource<TestState> for Tight {
        fn policy(_state: &TestState) -> PagePolicy {
            PagePolicy::bounded(Limit::new(10).unwrap(), Limit::new(20).unwrap()).unwrap()
        }
    }

    #[tokio::test]
    async fn extracts_validated_pagination_from_query() {
        let state = TestState {
            cfg: PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap(),
        };
        let request =
            Request::builder().uri("/files?after=42&limit=50").body(Body::empty()).unwrap();
        let (mut parts, _) = request.into_parts();

        let page = Pagination::<usize>::from_request_parts(&mut parts, &state).await.unwrap();

        assert_eq!(page.after(), Some(&42));
        assert_eq!(page.limit().get(), 50);
    }

    #[tokio::test]
    async fn applies_default_limit_when_query_omits_it() {
        let state = TestState {
            cfg: PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap(),
        };
        let request = Request::builder().uri("/files").body(Body::empty()).unwrap();
        let (mut parts, _) = request.into_parts();

        let page = Pagination::<usize>::from_request_parts(&mut parts, &state).await.unwrap();

        assert_eq!(page.after(), None);
        assert_eq!(page.limit().get(), 25);
    }

    #[tokio::test]
    async fn rejects_limit_above_configured_max() {
        let state = TestState {
            cfg: PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap(),
        };
        let request = Request::builder().uri("/files?limit=101").body(Body::empty()).unwrap();
        let (mut parts, _) = request.into_parts();

        let err = Pagination::<usize>::from_request_parts(&mut parts, &state).await.unwrap_err();

        assert_eq!(err.code(), "invalid_pagination");
        assert_eq!(err.status_code().as_u16(), 422);
    }

    #[tokio::test]
    async fn uses_explicit_policy_when_requested() {
        let state = TestState { cfg: PagePolicy::unbounded(Limit::new(200).unwrap()) };
        let request = Request::builder().uri("/files?limit=21").body(Body::empty()).unwrap();
        let (mut parts, _) = request.into_parts();

        let err =
            Pagination::<usize, Tight>::from_request_parts(&mut parts, &state).await.unwrap_err();

        assert_eq!(err.code(), "invalid_pagination");
        assert_eq!(err.status_code().as_u16(), 422);
    }

    #[tokio::test]
    async fn decodes_public_cursor_into_domain_cursor() {
        let state = TestState {
            cfg: PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap(),
        };
        let id = TestId::new();
        let request = Request::builder()
            .uri(format!("/files?after={}&limit=50", PublicId::from(id)))
            .body(Body::empty())
            .unwrap();
        let (mut parts, _) = request.into_parts();

        let page = Pagination::<TestId, DefaultPagePolicy, PublicId<TestId>>::from_request_parts(
            &mut parts, &state,
        )
        .await
        .unwrap();

        assert_eq!(page.after(), Some(&id));
        assert_eq!(page.limit().get(), 50);
    }
}
