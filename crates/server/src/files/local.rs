use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::fs::{self, File};
use tokio::sync::RwLock;

use crate::error::FileError;
use crate::files::meta::{BlobId, BlobKey, BlobRecord, StagedBlob, StoredBlob};
use crate::files::store::BlobStore;

#[derive(Clone)]
pub struct LocalBlobStore {
    root: PathBuf,
    index: Arc<RwLock<HashMap<BlobId, StoredBlob>>>,
}

impl LocalBlobStore {
    pub async fn new(root: PathBuf) -> Result<Self, FileError> {
        fs::create_dir_all(&root).await.map_err(|source| FileError::CreateDir { source })?;
        Ok(Self { root, index: Arc::new(RwLock::new(HashMap::new())) })
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

    async fn list(&self) -> Result<Vec<BlobRecord>, FileError> {
        Ok(self.index.read().await.values().map(BlobRecord::from).collect())
    }
}
