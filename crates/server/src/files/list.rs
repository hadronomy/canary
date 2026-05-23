use std::future::Future;

use crate::error::FileError;
use crate::files::meta::{BlobId, BlobRecord};
use crate::files::service::FileService;
use crate::pagination::{Limit, Page, PageRequest, PageWindow};

/// One-page file listing request.
///
/// Build it from [`FileService::list`](crate::files::service::FileService::list),
/// refine it with cursor methods like [`after`](Self::after), then either fetch
/// one page with [`page`](Self::page) or walk all pages with
/// [`paginated`](crate::pagination::PageRequest::paginated).
#[must_use = "page requests do nothing unless you fetch a page or walk them"]
#[derive(Clone)]
pub struct ListBlobs {
    files: FileService,
    window: PageWindow<BlobId>,
}

impl ListBlobs {
    pub(crate) fn new(files: FileService, limit: Limit) -> Self {
        Self { files, window: PageWindow::new(limit) }
    }

    /// Returns a new request that starts after the provided blob id.
    pub fn after(mut self, after: BlobId) -> Self {
        self.window = self.window.with_after(Some(after));
        self
    }

    /// Returns a new request with an optional cursor applied.
    pub fn after_opt(self, after: Option<BlobId>) -> Self {
        match after {
            Some(after) => self.after(after),
            None => self,
        }
    }

    /// Fetches one page for the current cursor window.
    ///
    /// # Errors
    ///
    /// Returns [`FileError`] if the underlying store cannot produce the page.
    pub async fn page(&self) -> Result<Page<BlobRecord, BlobId>, FileError> {
        self.files.list_page(self.window.clone()).await
    }

    #[must_use]
    pub(crate) fn window(&self) -> &PageWindow<BlobId> {
        &self.window
    }

    /// Returns the current page window for this request.
    #[must_use]
    pub fn page_window(&self) -> &PageWindow<BlobId> {
        self.window()
    }
}

impl PageRequest for ListBlobs {
    type Item = BlobRecord;
    type Cursor = BlobId;
    type Error = FileError;

    fn fetch_page(
        &self,
    ) -> impl Future<Output = Result<Page<Self::Item, Self::Cursor>, Self::Error>> + Send {
        let files = self.files.clone();
        let window = self.window.clone();
        async move { files.list_page(window).await }
    }

    fn with_cursor(&self, after: Option<Self::Cursor>) -> Self {
        Self { files: self.files.clone(), window: self.window.clone().with_after(after) }
    }
}
