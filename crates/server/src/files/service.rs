use std::path::PathBuf;

use axum::body::Body;
use axum_typed_multipart::FieldData;
use tempfile::NamedTempFile;
use tokio::fs::File;

use crate::config::FilesConfig;
use crate::error::FileError;
use crate::files::list::ListBlobs;
use crate::files::local::LocalBlobStore;
use crate::files::meta::{BlobId, BlobName, BlobRecord, StoredBlob};
use crate::files::stage::{stage_body, stage_multipart};
use crate::files::store::BlobStore;
use crate::pagination::{Limit, Page, PageWindow};

#[derive(Clone)]
pub struct FileService {
    cfg: FilesConfig,
    store: LocalBlobStore,
    staging: PathBuf,
}

impl FileService {
    pub async fn new(cfg: FilesConfig) -> Result<Self, FileError> {
        let store = LocalBlobStore::new(cfg.root.as_path().to_path_buf()).await?;
        let staging = cfg.root.as_path().join(".staging");
        tokio::fs::create_dir_all(&staging)
            .await
            .map_err(|source| FileError::CreateDir { source })?;
        Ok(Self { cfg, store, staging })
    }

    pub async fn put_body(
        &self,
        name: Option<BlobName>,
        declared: Option<mime::Mime>,
        body: Body,
    ) -> Result<StoredBlob, FileError> {
        let staged = stage_body(&self.staging, &self.cfg.uploads, name, declared, body).await?;
        self.store.put(staged).await
    }

    pub async fn put_multipart(
        &self,
        field: FieldData<NamedTempFile>,
    ) -> Result<StoredBlob, FileError> {
        let staged = stage_multipart(&self.staging, &self.cfg.uploads, field).await?;
        self.store.put(staged).await
    }

    pub async fn get(&self, id: BlobId) -> Result<(StoredBlob, File), FileError> {
        self.store.get(id).await
    }

    pub async fn head(&self, id: BlobId) -> Result<StoredBlob, FileError> {
        self.store.head(id).await
    }

    /// Creates a one-page file listing request.
    ///
    /// Fetch one page with [`ListBlobs::page`](crate::files::list::ListBlobs::page)
    /// or walk all pages with
    /// [`PageRequest::paginated`](crate::pagination::PageRequest::paginated).
    /// In Axum handlers, pair this with
    /// [`Pagination`](crate::http::extract::Pagination) to receive a validated
    /// cursor window from query parameters.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// # use futures_util::TryStreamExt;
    /// # use canary_server::{FileService, Limit, PageRequest};
    /// # async fn run() -> Result<(), Box<dyn std::error::Error>> {
    /// # let files: FileService = todo!();
    /// let page = files.list(Limit::new(100)?).page().await?;
    ///
    /// let all = files
    ///     .list(Limit::new(100)?)
    ///     .paginated()
    ///     .into_stream()
    ///     .try_collect::<Vec<_>>()
    ///     .await?;
    /// #
    /// # let _ = page;
    /// # let _ = all;
    /// # Ok(())
    /// # }
    /// ```
    pub fn list(&self, limit: Limit) -> ListBlobs {
        ListBlobs::new(self.clone(), limit)
    }

    pub(crate) async fn list_page(
        &self,
        window: PageWindow<BlobId>,
    ) -> Result<Page<BlobRecord, BlobId>, FileError> {
        self.store.list_page(window).await
    }

    #[must_use]
    pub fn chunk_size(&self) -> usize {
        self.cfg.uploads.chunk_size_bytes
    }
}
