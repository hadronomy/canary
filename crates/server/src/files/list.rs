use std::future::Future;

use crate::error::FileError;
use crate::files::meta::{BlobId, BlobRecord};
use crate::files::service::FileService;
use crate::pagination::{Limit, Page, PageRequest, PageWindow};

#[derive(Clone)]
pub struct ListBlobs {
    files: FileService,
    window: PageWindow<BlobId>,
}

impl ListBlobs {
    #[must_use]
    pub fn new(files: FileService, limit: Limit) -> Self {
        Self { files, window: PageWindow::new(limit) }
    }

    #[must_use]
    pub fn after(mut self, after: BlobId) -> Self {
        self.window = self.window.with_after(Some(after));
        self
    }

    #[must_use]
    pub fn window(&self) -> &PageWindow<BlobId> {
        &self.window
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
