use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures_util::Stream;
use futures_util::stream::BoxStream;
use object_store::buffered::BufWriter;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::{Attribute, Attributes, DynObjectStore, ObjectMeta};
use tokio::fs;
use tokio::io::{AsyncWrite, AsyncWriteExt, BufReader};

use crate::config::FileBackendConfig;
use crate::error::FileError;
use crate::files::direct::{MultipartSession, S3DirectBackend, S3RuntimeConfig};
use crate::files::meta::{BlobId, BlobKey, ReadyKey, StagedBlob, StagingKey, StoredBlob};
use crate::files::upload::{
    CompletedUploadPart, DirectPutAccess, MultipartUploadId, PartNumber, SignedUploadPart,
};

pub struct BlobRead {
    body: BoxStream<'static, object_store::Result<Bytes>>,
}

impl Stream for BlobRead {
    type Item = object_store::Result<Bytes>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.get_mut().body.as_mut().poll_next(cx)
    }
}

pub struct BlobWrite {
    inner: BufWriter,
}

impl AsyncWrite for BlobWrite {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

#[derive(Debug, Clone)]
pub struct BlobHead {
    pub size: u64,
    pub etag: Option<String>,
    pub version: Option<String>,
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
    chunk: usize,
    prefix: Option<String>,
    store: Arc<DynObjectStore>,
}

impl Backend {
    pub async fn new(cfg: &FileBackendConfig, chunk: usize) -> Result<Self, FileError> {
        match cfg {
            FileBackendConfig::Local(local) => {
                fs::create_dir_all(local.root.as_path())
                    .await
                    .map_err(|source| FileError::CreateDir { source })?;
                let store = LocalFileSystem::new_with_prefix(local.root.as_path())
                    .map_err(|source| FileError::Store { source: Box::new(source) })?;
                Ok(Self::Local(LocalBackend {
                    bytes: ObjectBytes {
                        chunk: chunk.max(1),
                        prefix: None,
                        store: Arc::new(store),
                    },
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
                        chunk: chunk.max(1),
                        prefix: runtime.prefix().map(ToOwned::to_owned),
                        store: Arc::new(store),
                    },
                    direct: S3DirectBackend::new(&runtime).await?,
                }))
            }
        }
    }

    pub async fn put(&self, staged: StagedBlob) -> Result<StoredBlob, FileError> {
        self.bytes().put(staged).await
    }

    pub async fn begin_write(&self, key: &StagingKey, ty: &str) -> Result<BlobWrite, FileError> {
        match self {
            Self::Local(local) => local.bytes.begin_write(key, None).await,
            Self::S3(s3) => s3.bytes.begin_write(key, Some(ty)).await,
        }
    }

    pub async fn open(&self, blob: &StoredBlob) -> Result<BlobRead, FileError> {
        self.bytes().open(blob).await
    }

    pub async fn head_staging(&self, key: &StagingKey) -> Result<BlobHead, FileError> {
        self.bytes().head_staging(key).await
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
        expires: std::time::Duration,
    ) -> Result<DirectPutAccess, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.sign_put(s3.bytes.object_key(key.blob()).as_str(), ty, expires).await
            }
        }
    }

    pub async fn create_multipart(
        &self,
        key: &StagingKey,
        ty: Option<&mime::Mime>,
    ) -> Result<MultipartSession, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.create_multipart(s3.bytes.object_key(key.blob()).as_str(), ty).await
            }
        }
    }

    pub async fn sign_parts(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
        parts: &[PartNumber],
        expires: std::time::Duration,
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
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct
                    .complete_multipart(s3.bytes.object_key(key.blob()).as_str(), upload_id, parts)
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
            Self::Local(_) => Ok(()),
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
    async fn put(&self, staged: StagedBlob) -> Result<StoredBlob, FileError> {
        let key = ReadyKey::from_id(staged.id);
        let path = self.path(key.blob());
        let file =
            fs::File::open(&staged.path).await.map_err(|source| FileError::Open { source })?;
        let mut src = BufReader::with_capacity(self.chunk, file);
        let mut dst = BufWriter::new(Arc::clone(&self.store), path);
        tokio::io::copy(&mut src, &mut dst)
            .await
            .map_err(|source| FileError::Persist { source })?;
        dst.shutdown().await.map_err(|source| FileError::Persist { source })?;
        if let Err(source) = fs::remove_file(&staged.path).await {
            tracing::warn!(%source, path = %staged.path.display(), "failed to clean staged blob");
        }
        Ok(StoredBlob {
            id: staged.id,
            key,
            name: staged.name,
            size: staged.size,
            hash: Some(staged.hash),
            kind: staged.kind,
            etag: None,
            version: None,
        })
    }

    async fn begin_write(
        &self,
        key: &StagingKey,
        ty: Option<&str>,
    ) -> Result<BlobWrite, FileError> {
        let inner = match ty {
            Some(ty) => BufWriter::new(Arc::clone(&self.store), self.path(key.blob()))
                .with_attributes(Attributes::from_iter([(Attribute::ContentType, ty.to_owned())])),
            None => BufWriter::new(Arc::clone(&self.store), self.path(key.blob())),
        };
        Ok(BlobWrite { inner })
    }

    async fn open(&self, blob: &StoredBlob) -> Result<BlobRead, FileError> {
        let get = self
            .store
            .get(&self.path(blob.key.blob()))
            .await
            .map_err(|source| map_store_err(blob.id, source))?;
        Ok(BlobRead { body: get.into_stream() })
    }

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

fn map_store_err(id: BlobId, source: object_store::Error) -> FileError {
    match source {
        object_store::Error::NotFound { .. } => FileError::NotFound { id },
        source => FileError::Store { source: Box::new(source) },
    }
}

impl From<ObjectMeta> for BlobHead {
    fn from(meta: ObjectMeta) -> Self {
        Self { size: meta.size, etag: meta.e_tag, version: meta.version }
    }
}

fn map_upload_err(source: object_store::Error) -> FileError {
    match source {
        object_store::Error::NotFound { .. } => FileError::UploadIncomplete,
        source => FileError::Store { source: Box::new(source) },
    }
}
