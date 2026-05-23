use std::collections::VecDeque;
use std::future::Future;
use std::num::NonZeroUsize;

use futures_util::stream::{self, Stream};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct Limit(NonZeroUsize);

impl Limit {
    pub fn new(value: usize) -> Result<Self, PaginationError> {
        NonZeroUsize::new(value).map(Self).ok_or(PaginationError::InvalidLimit)
    }

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
    #[error("page limit must be greater than zero")]
    InvalidLimit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Page<T, C> {
    pub items: Vec<T>,
    pub next: Option<C>,
}

impl<T, C> Page<T, C> {
    #[must_use]
    pub fn new(items: Vec<T>, next: Option<C>) -> Self {
        Self { items, next }
    }

    #[must_use]
    pub fn from_items(items: impl IntoIterator<Item = T>, next: Option<C>) -> Self {
        Self { items: items.into_iter().collect(), next }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageWindow<C> {
    after: Option<C>,
    limit: Limit,
}

impl<C> PageWindow<C> {
    #[must_use]
    pub fn new(limit: Limit) -> Self {
        Self { after: None, limit }
    }

    #[must_use]
    pub fn from_parts(after: Option<C>, limit: Limit) -> Self {
        Self { after, limit }
    }

    #[must_use]
    pub fn after(&self) -> Option<&C> {
        self.after.as_ref()
    }

    #[must_use]
    pub fn limit(&self) -> Limit {
        self.limit
    }

    #[must_use]
    pub fn with_after(mut self, after: Option<C>) -> Self {
        self.after = after;
        self
    }
}

pub trait PageRequest: Clone + Send + Sync + 'static {
    type Item: Send + 'static;
    type Cursor: Clone + Send + Sync + 'static;
    type Error: Send + 'static;

    fn fetch_page(
        &self,
    ) -> impl Future<Output = Result<Page<Self::Item, Self::Cursor>, Self::Error>> + Send;

    fn with_cursor(&self, after: Option<Self::Cursor>) -> Self;

    fn paginated(self) -> Paginated<Self>
    where
        Self: Sized,
    {
        Paginated::new(self)
    }
}

#[derive(Debug, Clone)]
pub struct Paginated<R> {
    req: R,
}

impl<R> Paginated<R> {
    #[must_use]
    pub fn new(req: R) -> Self {
        Self { req }
    }
}

impl<R> Paginated<R>
where
    R: PageRequest,
{
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

    use futures_util::TryStreamExt;
    use thiserror::Error;

    use super::{Page, PageRequest};

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
}
