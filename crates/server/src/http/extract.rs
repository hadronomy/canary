//! Small HTTP extractors layered on top of the core server types.

use std::marker::PhantomData;

use axum::body::Body;
use axum::extract::{FromRef, FromRequestParts, Query};
use axum::http::HeaderMap;
use axum::http::request::Parts;

use crate::error::AppError;
use crate::pagination::{DefaultPagePolicy, PagePolicy, PagePolicySource, PageQuery, PageWindow};
use crate::state::AppState;

/// Axum extractor for validated pagination state.
///
/// This extractor:
///
/// - deserializes a shared [`PageQuery`] from the query string
/// - applies configured defaults and optional bounds
/// - yields a validated [`PageWindow`]-shaped value to the handler
///
/// It is designed to keep handlers focused on domain logic rather than query
/// parsing and limit validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pagination<C, P = DefaultPagePolicy> {
    window: PageWindow<C>,
    policy: PhantomData<P>,
}

impl<C, P> Pagination<C, P> {
    #[must_use]
    pub fn after(&self) -> Option<&C> {
        self.window.after()
    }

    #[must_use]
    pub fn limit(&self) -> crate::pagination::Limit {
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

impl<C, P> From<PageWindow<C>> for Pagination<C, P> {
    fn from(window: PageWindow<C>) -> Self {
        Self { window, policy: PhantomData }
    }
}

impl<C, P> From<Pagination<C, P>> for PageWindow<C> {
    fn from(value: Pagination<C, P>) -> Self {
        value.window
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

impl<S, C, P> FromRequestParts<S> for Pagination<C, P>
where
    S: Send + Sync,
    P: PagePolicySource<S>,
    C: Clone + Send + Sync + 'static,
    PageQuery<C>: serde::de::DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let query = Query::<PageQuery<C>>::from_request_parts(parts, state)
            .await
            .map_err(|err| AppError::bad_request(format!("invalid pagination query: {err}")))?;
        let window = P::policy(state)
            .resolve(query.0)
            .map_err(|err| AppError::bad_request(format!("invalid pagination query: {err}")))?;
        Ok(Self { window, policy: PhantomData })
    }
}

impl FromRef<AppState> for PagePolicy {
    fn from_ref(state: &AppState) -> Self {
        state.loaded_config().settings.http.pagination.clone()
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::extract::{FromRef, FromRequestParts};
    use http::Request;

    use super::Pagination;
    use crate::pagination::{Limit, PagePolicy, PagePolicySource};

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

        assert_eq!(err.code(), "bad_request");
        assert!(err.to_string().contains("must not exceed 100"));
    }

    #[tokio::test]
    async fn uses_explicit_policy_when_requested() {
        let state = TestState { cfg: PagePolicy::unbounded(Limit::new(200).unwrap()) };
        let request = Request::builder().uri("/files?limit=21").body(Body::empty()).unwrap();
        let (mut parts, _) = request.into_parts();

        let err =
            Pagination::<usize, Tight>::from_request_parts(&mut parts, &state).await.unwrap_err();

        assert_eq!(err.code(), "bad_request");
        assert!(err.to_string().contains("must not exceed 20"));
    }
}
