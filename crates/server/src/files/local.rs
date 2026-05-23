use std::collections::BTreeMap;
use std::ops::Bound::{Excluded, Unbounded};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::fs::{self, File};
use tokio::sync::RwLock;

use crate::error::FileError;
use crate::files::meta::{BlobId, BlobKey, BlobRecord, StagedBlob, StoredBlob};
use crate::files::store::BlobStore;
use crate::pagination::{Page, PageWindow};

#[derive(Clone)]
pub struct LocalBlobStore {
    root: PathBuf,
    index: Arc<RwLock<BTreeMap<BlobId, StoredBlob>>>,
}

impl LocalBlobStore {
    pub async fn new(root: PathBuf) -> Result<Self, FileError> {
        fs::create_dir_all(&root).await.map_err(|source| FileError::CreateDir { source })?;
        Ok(Self { root, index: Arc::new(RwLock::new(BTreeMap::new())) })
    }

    fn path(&self, id: BlobId) -> PathBuf {
        self.root.join(id.to_string())
    }
}

#[async_trait]
impl BlobStore for LocalBlobStore {
    async fn put(&self, staged: StagedBlob) -> Result<StoredBlob, FileError> {
        let path = self.path(staged.id);
        fs::rename(&staged.path, &path).await.map_err(|source| FileError::Persist { source })?;
        let stored = StoredBlob {
            id: staged.id,
            key: BlobKey::new(staged.id.to_string()),
            name: staged.name,
            size: staged.size,
            hash: staged.hash,
            kind: staged.kind,
            path,
        };
        self.index.write().await.insert(stored.id, stored.clone());
        Ok(stored)
    }

    async fn get(&self, id: BlobId) -> Result<(StoredBlob, File), FileError> {
        let meta = self.head(id).await?;
        let file = File::open(&meta.path).await.map_err(|source| FileError::Open { source })?;
        Ok((meta, file))
    }

    async fn head(&self, id: BlobId) -> Result<StoredBlob, FileError> {
        self.index.read().await.get(&id).cloned().ok_or(FileError::NotFound { id })
    }

    async fn list_page(
        &self,
        window: PageWindow<BlobId>,
    ) -> Result<Page<BlobRecord, BlobId>, FileError> {
        let read = self.index.read().await;
        let mut iter = match window.after().copied() {
            Some(after) => read.range((Excluded(after), Unbounded)),
            None => read.range(..),
        };
        let mut items = Vec::with_capacity(window.limit().get());
        let mut last = None;

        for (_, blob) in iter.by_ref().take(window.limit().get()) {
            last = Some(blob.id);
            items.push(BlobRecord::from(blob));
        }

        let next = if last.is_some() && iter.next().is_some() { last } else { None };

        Ok(Page::new(items, next))
    }
}
