use async_trait::async_trait;
use tokio::fs::File;

use crate::error::FileError;
use crate::files::meta::{BlobId, BlobRecord, StagedBlob, StoredBlob};

#[async_trait]
pub trait BlobStore: Clone + Send + Sync + 'static {
    async fn put(&self, staged: StagedBlob) -> Result<StoredBlob, FileError>;
    async fn get(&self, id: BlobId) -> Result<(StoredBlob, File), FileError>;
    async fn head(&self, id: BlobId) -> Result<StoredBlob, FileError>;
    async fn list(&self) -> Result<Vec<BlobRecord>, FileError>;
}
