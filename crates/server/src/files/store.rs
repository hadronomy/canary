use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{DynObjectStore, ObjectMeta};
use tokio::fs;

use crate::config::FileBackendConfig;
use crate::error::FileError;
use crate::files::direct::{MultipartSession, S3DirectBackend, S3RuntimeConfig};
use crate::files::meta::{BlobChecksum, BlobKey, ReadyKey, Sha256Digest, StagingKey};
use crate::files::upload::{
    CompletedUploadPart, DirectPutAccess, MultipartUploadId, PartNumber, RequestedUploadPart,
    SignedUploadPart, UploadChecksum,
};

#[derive(Debug, Clone)]
pub struct BlobHead {
    pub size: u64,
    pub etag: Option<String>,
    pub version: Option<String>,
    pub checksum: Option<BlobChecksum>,
}

#[derive(Clone)]
pub enum Backend {
    Local(LocalBackend),
    S3(S3Backend),
}

#[derive(Clone)]
pub struct LocalBackend {
    bytes: ObjectBytes,
}

#[derive(Clone)]
pub struct S3Backend {
    bytes: ObjectBytes,
    direct: S3DirectBackend,
}

#[derive(Clone)]
struct ObjectBytes {
    prefix: Option<String>,
    store: Arc<DynObjectStore>,
}

impl Backend {
    pub async fn new(cfg: &FileBackendConfig, _chunk: usize) -> Result<Self, FileError> {
        match cfg {
            FileBackendConfig::Local(local) => {
                fs::create_dir_all(local.root.as_path())
                    .await
                    .map_err(|source| FileError::CreateDir { source })?;
                let store = LocalFileSystem::new_with_prefix(local.root.as_path())
                    .map_err(|source| FileError::Store { source: Box::new(source) })?;
                Ok(Self::Local(LocalBackend {
                    bytes: ObjectBytes { prefix: None, store: Arc::new(store) },
                }))
            }
            FileBackendConfig::S3(s3) => {
                let runtime = S3RuntimeConfig::from_file(s3);
                let store = runtime
                    .object_store_builder()
                    .build()
                    .map_err(|source| FileError::Store { source: Box::new(source) })?;
                Ok(Self::S3(S3Backend {
                    bytes: ObjectBytes {
                        prefix: runtime.prefix().map(ToOwned::to_owned),
                        store: Arc::new(store),
                    },
                    direct: S3DirectBackend::new(&runtime).await?,
                }))
            }
        }
    }

    pub async fn sign_get(
        &self,
        key: &ReadyKey,
        ty: &str,
        name: &str,
        expires: Duration,
    ) -> Result<String, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .sign_get(s3.bytes.object_key(key.blob()).as_str(), ty, name, expires)
                    .await
            }
        }
    }

    pub async fn head_staging(&self, key: &StagingKey) -> Result<BlobHead, FileError> {
        match self {
            Self::Local(local) => local.bytes.head_staging(key).await,
            Self::S3(s3) => s3.direct.head(s3.bytes.object_key(key.blob()).as_str()).await,
        }
    }

    pub async fn peek_staging(&self, key: &StagingKey, len: usize) -> Result<Bytes, FileError> {
        self.bytes().peek_staging(key, len).await
    }

    pub async fn delete_staging(&self, key: &StagingKey) -> Result<(), FileError> {
        self.bytes().delete_staging(key).await
    }

    /// Promotes a validated upload from staging into the ready namespace.
    ///
    /// Uploads always land under staging keys first. Only after the server has
    /// inspected and accepted the bytes do they move into a ready key that the
    /// rest of the system can serve. S3-compatible backends also canonicalize
    /// `Content-Type` during this promotion step so the stored object metadata
    /// matches Canary's validated media decision.
    pub async fn promote(
        &self,
        from: &StagingKey,
        to: &ReadyKey,
        ty: &str,
    ) -> Result<BlobHead, FileError> {
        match self {
            Self::Local(local) => local.bytes.promote(from, to).await,
            Self::S3(s3) => {
                s3.direct
                    .promote(
                        s3.bytes.object_key(from.blob()).as_str(),
                        s3.bytes.object_key(to.blob()).as_str(),
                        ty,
                    )
                    .await?;
                s3.bytes.head_ready(to).await
            }
        }
    }

    pub async fn sign_put(
        &self,
        key: &StagingKey,
        ty: Option<&mime::Mime>,
        sha256: Option<&Sha256Digest>,
        expires: std::time::Duration,
    ) -> Result<DirectPutAccess, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .sign_put(s3.bytes.object_key(key.blob()).as_str(), ty, sha256, expires)
                    .await
            }
        }
    }

    pub async fn create_multipart(
        &self,
        key: &StagingKey,
        ty: Option<&mime::Mime>,
        checksum: UploadChecksum,
    ) -> Result<MultipartSession, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .create_multipart(s3.bytes.object_key(key.blob()).as_str(), ty, checksum)
                    .await
            }
        }
    }

    pub async fn sign_parts(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
        parts: &[RequestedUploadPart],
        expires: Duration,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .sign_parts(s3.bytes.object_key(key.blob()).as_str(), upload_id, parts, expires)
                    .await
            }
        }
    }

    pub async fn list_multipart_parts(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
    ) -> Result<Vec<PartNumber>, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.list_parts(s3.bytes.object_key(key.blob()).as_str(), upload_id).await
            }
        }
    }

    pub async fn complete_multipart(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
        checksum: &str,
        size: u64,
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .complete_multipart(
                        s3.bytes.object_key(key.blob()).as_str(),
                        upload_id,
                        checksum,
                        size,
                        parts,
                    )
                    .await
            }
        }
    }

    pub async fn abort_multipart(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
    ) -> Result<(), FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.abort_multipart(s3.bytes.object_key(key.blob()).as_str(), upload_id).await
            }
        }
    }

    #[must_use]
    pub fn supports_direct(&self) -> bool {
        matches!(self, Self::S3(_))
    }

    fn bytes(&self) -> &ObjectBytes {
        match self {
            Self::Local(local) => &local.bytes,
            Self::S3(s3) => &s3.bytes,
        }
    }
}

impl ObjectBytes {
    async fn head_staging(&self, key: &StagingKey) -> Result<BlobHead, FileError> {
        let meta = self.store.head(&self.path(key.blob())).await.map_err(map_upload_err)?;
        Ok(BlobHead::from(meta))
    }

    async fn head_ready(&self, key: &ReadyKey) -> Result<BlobHead, FileError> {
        let meta = self.store.head(&self.path(key.blob())).await.map_err(map_upload_err)?;
        Ok(BlobHead::from(meta))
    }

    async fn peek_staging(&self, key: &StagingKey, len: usize) -> Result<Bytes, FileError> {
        self.store.get_range(&self.path(key.blob()), 0..len as u64).await.map_err(map_upload_err)
    }

    async fn delete_staging(&self, key: &StagingKey) -> Result<(), FileError> {
        self.store
            .delete(&self.path(key.blob()))
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })
    }

    async fn promote(&self, from: &StagingKey, to: &ReadyKey) -> Result<BlobHead, FileError> {
        self.store
            .rename(&self.path(from.blob()), &self.path(to.blob()))
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        self.head_ready(to).await
    }

    fn path(&self, key: &BlobKey) -> ObjectPath {
        ObjectPath::from(self.object_key(key))
    }

    fn object_key(&self, key: &BlobKey) -> String {
        match self.prefix.as_deref() {
            Some(prefix) => format!("{prefix}/{}", key.as_str()),
            None => key.as_str().to_owned(),
        }
    }
}

impl From<ObjectMeta> for BlobHead {
    fn from(meta: ObjectMeta) -> Self {
        Self { size: meta.size, etag: meta.e_tag, version: meta.version, checksum: None }
    }
}

fn map_upload_err(source: object_store::Error) -> FileError {
    match source {
        object_store::Error::NotFound { .. } => FileError::UploadIncomplete,
        source => FileError::Store { source: Box::new(source) },
    }
}
