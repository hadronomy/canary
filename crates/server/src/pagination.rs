//! Pagination primitives for request-shaped APIs.
//!
//! The intended model is:
//!
//! - one request value knows how to fetch one page
//! - [`Paginated`] adapts that request into a safe sequential walker
//! - [`PageQuery`] carries the shared wire format for HTTP query params
//! - [`PagePolicy`] resolves that wire format into a validated page window
//! - concrete APIs expose the request value from their service or client handle
//!
//! # Examples
//!
//! ```no_run
//! # use futures_util::TryStreamExt;
//! # use canary_server::{FileService, Limit, PageQuery, PageRequest};
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! # let files: FileService = todo!();
//! let page = files.list(Limit::new(100)?).page().await?;
//! let all: Vec<_> = files
//!     .list(Limit::new(100)?)
//!     .paginated()
//!     .into_stream()
//!     .try_collect()
//!     .await?;
//! #
//! # let _ = page;
//! # let _ = all;
//! let query = PageQuery::<String>::new().with_limit(Some(Limit::new(100)?));
//! # let _ = query;
//! # Ok(())
//! # }
//! ```

use std::collections::VecDeque;
use std::future::Future;
use std::num::NonZeroUsize;

use futures_util::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Limit(NonZeroUsize);

impl Limit {
    /// Creates a validated page limit.
    ///
    /// # Errors
    ///
    /// Returns [`PaginationError::InvalidLimit`] if `value` is zero.
    pub fn new(value: usize) -> Result<Self, PaginationError> {
        NonZeroUsize::new(value).map(Self).ok_or(PaginationError::InvalidLimit)
    }

    /// Returns the validated limit as a plain `usize`.
    #[must_use]
    pub const fn get(self) -> usize {
        self.0.get()
    }
}

impl TryFrom<usize> for Limit {
    type Error = PaginationError;

    fn try_from(value: usize) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum PaginationError {
    /// The provided limit was zero.
    #[error("page limit must be greater than zero")]
    InvalidLimit,
    /// The requested limit exceeds the configured maximum.
    #[error("page limit must not exceed {max}")]
    LimitTooLarge { max: usize },
    /// The configured default limit is greater than the configured maximum.
    #[error("default page limit {default} must not exceed max page limit {max}")]
    DefaultLimitExceedsMax { default: usize, max: usize },
}

/// One materialized page of items plus the cursor for the next page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page<T, C> {
    /// Items returned in this page.
    pub items: Vec<T>,
    /// Cursor to pass back to the request to continue after this page.
    pub next: Option<C>,
}

impl<T, C> Page<T, C> {
    /// Creates a page from an already materialized item vector.
    #[must_use]
    pub fn new(items: Vec<T>, next: Option<C>) -> Self {
        Self { items, next }
    }

    /// Creates a page by collecting items from an iterator.
    #[must_use]
    pub fn from_items(items: impl IntoIterator<Item = T>, next: Option<C>) -> Self {
        Self { items: items.into_iter().collect(), next }
    }
}

/// Shared HTTP query representation for cursor pagination.
///
/// This type is intentionally serde-friendly so it can be:
///
/// - extracted from Axum query strings
/// - serialized into query strings for `reqwest::RequestBuilder::query`
///
/// Keep this as the wire shape and convert it into a validated [`PageWindow`]
/// through [`PagePolicy::resolve`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageQuery<C> {
    #[serde(skip_serializing_if = "Option::is_none")]
    after: Option<C>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<Limit>,
}

impl<C> PageQuery<C> {
    /// Creates an empty pagination query that relies on server defaults.
    #[must_use]
    pub fn new() -> Self {
        Self { after: None, limit: None }
    }

    /// Returns the raw `after` cursor from the query.
    #[must_use]
    pub fn after(&self) -> Option<&C> {
        self.after.as_ref()
    }

    /// Returns the raw `limit` from the query.
    #[must_use]
    pub fn limit(&self) -> Option<Limit> {
        self.limit
    }

    /// Returns a new query with an updated cursor.
    #[must_use]
    pub fn with_after(mut self, after: Option<C>) -> Self {
        self.after = after;
        self
    }

    /// Returns a new query with an updated limit.
    #[must_use]
    pub fn with_limit(mut self, limit: Option<Limit>) -> Self {
        self.limit = limit;
        self
    }
}

impl<C> From<PageWindow<C>> for PageQuery<C> {
    fn from(value: PageWindow<C>) -> Self {
        Self { after: value.after, limit: Some(value.limit) }
    }
}

/// Cursor window used for one page request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageWindow<C> {
    after: Option<C>,
    limit: Limit,
}

impl<C> PageWindow<C> {
    /// Creates the first page window for a limit.
    #[must_use]
    pub fn new(limit: Limit) -> Self {
        Self { after: None, limit }
    }

    /// Creates a page window from explicit cursor parts.
    #[must_use]
    pub fn from_parts(after: Option<C>, limit: Limit) -> Self {
        Self { after, limit }
    }

    /// Returns the cursor after which the next page should start.
    #[must_use]
    pub fn after(&self) -> Option<&C> {
        self.after.as_ref()
    }

    /// Returns the requested page size.
    #[must_use]
    pub fn limit(&self) -> Limit {
        self.limit
    }

    /// Returns a new window with a different `after` cursor.
    #[must_use]
    pub fn with_after(mut self, after: Option<C>) -> Self {
        self.after = after;
        self
    }
}

/// Validated pagination defaults and optional bounds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PagePolicy {
    default: Limit,
    max: Option<Limit>,
}

impl PagePolicy {
    /// Creates validated pagination settings.
    ///
    /// # Errors
    ///
    /// Returns [`PaginationError::DefaultLimitExceedsMax`] if `default` is
    /// greater than `max`.
    pub fn new(default: Limit, max: Option<Limit>) -> Result<Self, PaginationError> {
        if let Some(max) = max
            && default.get() > max.get()
        {
            return Err(PaginationError::DefaultLimitExceedsMax {
                default: default.get(),
                max: max.get(),
            });
        }
        Ok(Self { default, max })
    }

    /// Creates an unbounded pagination policy with a validated default limit.
    #[must_use]
    pub fn unbounded(default: Limit) -> Self {
        Self { default, max: None }
    }

    /// Creates a bounded pagination policy with validated default and max limits.
    ///
    /// # Errors
    ///
    /// Returns [`PaginationError::DefaultLimitExceedsMax`] if `default` is
    /// greater than `max`.
    pub fn bounded(default: Limit, max: Limit) -> Result<Self, PaginationError> {
        Self::new(default, Some(max))
    }

    /// Returns the configured default page limit.
    #[must_use]
    pub fn default_limit(&self) -> Limit {
        self.default
    }

    /// Returns the configured maximum page limit, if one exists.
    #[must_use]
    pub fn max_limit(&self) -> Option<Limit> {
        self.max
    }

    /// Resolves a wire query into a validated page window.
    ///
    /// # Errors
    ///
    /// Returns [`PaginationError::LimitTooLarge`] if the requested limit is
    /// greater than the configured maximum.
    pub fn resolve<C>(&self, query: PageQuery<C>) -> Result<PageWindow<C>, PaginationError> {
        let limit = query.limit.unwrap_or(self.default);
        if let Some(max) = self.max
            && limit.get() > max.get()
        {
            return Err(PaginationError::LimitTooLarge { max: max.get() });
        }
        Ok(PageWindow::from_parts(query.after, limit))
    }
}

/// A type-level source of pagination policy for a given integration state.
pub trait PagePolicySource<S> {
    /// Returns the pagination policy that should be applied to this request.
    fn policy(state: &S) -> PagePolicy;
}

/// Marker for "use the application default pagination policy".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DefaultPagePolicy;

/// A request-shaped value that knows how to fetch one page.
///
/// Implement this trait on a focused request object. The request should own the
/// state needed to fetch one page, while [`Paginated`] handles walking forward
/// through successive cursors.
pub trait PageRequest: Clone + Send + Sync + 'static {
    type Item: Send + 'static;
    type Cursor: Clone + Send + Sync + 'static;
    type Error: Send + 'static;

    /// Fetches exactly one page for the current request state.
    fn fetch_page(
        &self,
    ) -> impl Future<Output = Result<Page<Self::Item, Self::Cursor>, Self::Error>> + Send;

    /// Returns the same request advanced to a new cursor position.
    fn with_cursor(&self, after: Option<Self::Cursor>) -> Self;

    /// Wraps this one-page request in a sequential page walker.
    fn paginated(self) -> Paginated<Self>
    where
        Self: Sized,
    {
        Paginated::new(self)
    }
}

/// Sequential adaptor that walks a [`PageRequest`] forward through all pages.
#[must_use = "paginators do nothing unless you turn them into a stream"]
#[derive(Debug, Clone)]
pub struct Paginated<R> {
    req: R,
}

impl<R> Paginated<R> {
    /// Creates a paginator from a one-page request.
    pub fn new(req: R) -> Self {
        Self { req }
    }
}

impl<R> Paginated<R>
where
    R: PageRequest,
{
    /// Streams whole pages in order.
    pub fn into_pages(
        self,
    ) -> impl Stream<Item = Result<Page<R::Item, R::Cursor>, R::Error>> + Send {
        stream::try_unfold(Some(self.req), |state| async move {
            let Some(req) = state else {
                return Ok(None);
            };

            let page = req.fetch_page().await?;
            let next = page.next.as_ref().cloned().map(|after| req.with_cursor(Some(after)));

            Ok(Some((page, next)))
        })
    }

    /// Streams items in order across all pages.
    ///
    /// This walker is intentionally sequential. It only requests the next page
    /// after the current page has been consumed.
    pub fn into_stream(self) -> impl Stream<Item = Result<R::Item, R::Error>> + Send {
        stream::try_unfold(
            WalkState { req: Some(self.req), buf: VecDeque::new() },
            |mut state| async move {
                loop {
                    if let Some(item) = state.buf.pop_front() {
                        return Ok(Some((item, state)));
                    }

                    let Some(req) = state.req.take() else {
                        return Ok(None);
                    };

                    let page = req.fetch_page().await?;
                    state.req =
                        page.next.as_ref().cloned().map(|after| req.with_cursor(Some(after)));
                    state.buf = page.items.into();

                    if state.buf.is_empty() && state.req.is_none() {
                        return Ok(None);
                    }
                }
            },
        )
    }
}

struct WalkState<R: PageRequest> {
    req: Option<R>,
    buf: VecDeque<R::Item>,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::extract::Query;
    use futures_util::TryStreamExt;
    use http::Uri;
    use thiserror::Error;

    use super::{Limit, Page, PagePolicy, PageQuery, PageRequest, PaginationError};

    #[derive(Clone)]
    struct FakeReq {
        pages: Arc<Vec<Page<&'static str, usize>>>,
        at: Option<usize>,
    }

    impl FakeReq {
        fn new(pages: Vec<Page<&'static str, usize>>) -> Self {
            Self { pages: Arc::new(pages), at: Some(0) }
        }
    }

    impl PageRequest for FakeReq {
        type Item = &'static str;
        type Cursor = usize;
        type Error = FakeErr;

        fn fetch_page(
            &self,
        ) -> impl Future<Output = Result<Page<Self::Item, Self::Cursor>, Self::Error>> + Send
        {
            let pages = self.pages.clone();
            let at = self.at;

            async move {
                let at = at.ok_or(FakeErr::MissingCursor)?;
                pages.get(at).cloned().ok_or(FakeErr::MissingPage(at))
            }
        }

        fn with_cursor(&self, after: Option<Self::Cursor>) -> Self {
            Self { pages: self.pages.clone(), at: after }
        }
    }

    #[derive(Debug, Clone, Error, PartialEq, Eq)]
    enum FakeErr {
        #[error("cursor is missing")]
        MissingCursor,
        #[error("page {0} is missing")]
        MissingPage(usize),
    }

    #[tokio::test]
    async fn streams_items_across_pages() {
        let req =
            FakeReq::new(vec![Page::new(vec!["a", "b"], Some(1)), Page::new(vec!["c"], None)]);

        let items: Vec<_> = req.paginated().into_stream().try_collect().await.unwrap();

        assert_eq!(items, vec!["a", "b", "c"]);
    }

    #[tokio::test]
    async fn preserves_page_boundaries() {
        let req =
            FakeReq::new(vec![Page::new(vec!["a"], Some(1)), Page::new(vec!["b", "c"], None)]);

        let pages: Vec<_> = req.paginated().into_pages().try_collect().await.unwrap();

        assert_eq!(pages, vec![Page::new(vec!["a"], Some(1)), Page::new(vec!["b", "c"], None),]);
    }

    #[tokio::test]
    async fn walks_past_empty_pages_when_cursor_advances() {
        let req = FakeReq::new(vec![
            Page::new(Vec::<&'static str>::new(), Some(1)),
            Page::new(vec!["b"], None),
        ]);

        let items: Vec<_> = req.paginated().into_stream().try_collect().await.unwrap();

        assert_eq!(items, vec!["b"]);
    }

    #[test]
    fn resolves_default_limit_when_query_omits_it() {
        let cfg = PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap();
        let window = cfg.resolve(PageQuery::<usize>::new()).unwrap();

        assert_eq!(window.after(), None);
        assert_eq!(window.limit().get(), 25);
    }

    #[test]
    fn rejects_limit_above_max() {
        let cfg = PagePolicy::bounded(Limit::new(25).unwrap(), Limit::new(100).unwrap()).unwrap();
        let err = cfg
            .resolve(PageQuery::<usize>::new().with_limit(Some(Limit::new(101).unwrap())))
            .unwrap_err();

        assert_eq!(err, PaginationError::LimitTooLarge { max: 100 });
    }

    #[test]
    fn allows_large_limits_when_policy_is_unbounded() {
        let cfg = PagePolicy::unbounded(Limit::new(25).unwrap());
        let window = cfg
            .resolve(PageQuery::<usize>::new().with_limit(Some(Limit::new(1_001).unwrap())))
            .unwrap();

        assert_eq!(window.limit().get(), 1_001);
    }

    #[test]
    fn parses_wire_query_from_uri() {
        let uri: Uri = "http://example.test/files?limit=25&after=42".parse().unwrap();
        let query: Query<PageQuery<usize>> = Query::try_from_uri(&uri).unwrap();

        assert_eq!(query.limit().unwrap().get(), 25);
        assert_eq!(query.after(), Some(&42));
    }
}
