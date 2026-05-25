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
use object_store::{DynObjectStore, ObjectMeta};
use tokio::fs;
use tokio::io::{AsyncWrite, AsyncWriteExt, BufReader};

use crate::config::FileBackendConfig;
use crate::error::FileError;
use crate::files::direct::{MultipartSession, S3DirectBackend, S3RuntimeConfig};
use crate::files::meta::{BlobId, BlobKey, StagedBlob, StoredBlob};
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

    pub async fn begin_write(&self, key: &BlobKey) -> Result<BlobWrite, FileError> {
        self.bytes().begin_write(key).await
    }

    pub async fn open(&self, blob: &StoredBlob) -> Result<BlobRead, FileError> {
        self.bytes().open(blob).await
    }

    pub async fn head(&self, key: &BlobKey) -> Result<BlobHead, FileError> {
        self.bytes().head(key).await
    }

    pub async fn peek(&self, key: &BlobKey, len: usize) -> Result<Bytes, FileError> {
        self.bytes().peek(key, len).await
    }

    pub async fn delete(&self, key: &BlobKey) -> Result<(), FileError> {
        self.bytes().delete(key).await
    }

    pub async fn sign_put(
        &self,
        key: &BlobKey,
        ty: Option<&mime::Mime>,
        expires: std::time::Duration,
    ) -> Result<DirectPutAccess, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => s3.direct.sign_put(s3.bytes.key(key).as_str(), ty, expires).await,
        }
    }

    pub async fn create_multipart(
        &self,
        key: &BlobKey,
        ty: Option<&mime::Mime>,
    ) -> Result<MultipartSession, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => s3.direct.create_multipart(s3.bytes.key(key).as_str(), ty).await,
        }
    }

    pub async fn sign_parts(
        &self,
        key: &BlobKey,
        upload_id: &MultipartUploadId,
        parts: &[PartNumber],
        expires: std::time::Duration,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.sign_parts(s3.bytes.key(key).as_str(), upload_id, parts, expires).await
            }
        }
    }

    pub async fn list_multipart_parts(
        &self,
        key: &BlobKey,
        upload_id: &MultipartUploadId,
    ) -> Result<Vec<PartNumber>, FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => s3.direct.list_parts(s3.bytes.key(key).as_str(), upload_id).await,
        }
    }

    pub async fn complete_multipart(
        &self,
        key: &BlobKey,
        upload_id: &MultipartUploadId,
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        match self {
            Self::Local(_) => Err(FileError::DirectUploadUnavailable),
            Self::S3(s3) => {
                s3.direct.complete_multipart(s3.bytes.key(key).as_str(), upload_id, parts).await
            }
        }
    }

    pub async fn abort_multipart(
        &self,
        key: &BlobKey,
        upload_id: &MultipartUploadId,
    ) -> Result<(), FileError> {
        match self {
            Self::Local(_) => Ok(()),
            Self::S3(s3) => s3.direct.abort_multipart(s3.bytes.key(key).as_str(), upload_id).await,
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
        let key = BlobKey::from_id(staged.id);
        let path = self.path(&key);
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

    async fn begin_write(&self, key: &BlobKey) -> Result<BlobWrite, FileError> {
        Ok(BlobWrite { inner: BufWriter::new(Arc::clone(&self.store), self.path(key)) })
    }

    async fn open(&self, blob: &StoredBlob) -> Result<BlobRead, FileError> {
        let get = self
            .store
            .get(&self.path(&blob.key))
            .await
            .map_err(|source| map_store_err(blob.id, source))?;
        Ok(BlobRead { body: get.into_stream() })
    }

    async fn head(&self, key: &BlobKey) -> Result<BlobHead, FileError> {
        let meta = self.store.head(&self.path(key)).await.map_err(map_upload_err)?;
        Ok(BlobHead::from(meta))
    }

    async fn peek(&self, key: &BlobKey, len: usize) -> Result<Bytes, FileError> {
        self.store.get_range(&self.path(key), 0..len as u64).await.map_err(map_upload_err)
    }

    async fn delete(&self, key: &BlobKey) -> Result<(), FileError> {
        self.store
            .delete(&self.path(key))
            .await
            .map_err(|source| FileError::Store { source: Box::new(source) })
    }

    fn path(&self, key: &BlobKey) -> ObjectPath {
        match self.prefix.as_deref() {
            Some(prefix) => ObjectPath::from_iter([prefix, key.as_str()]),
            None => ObjectPath::from(key.as_str()),
        }
    }

    fn key(&self, key: &BlobKey) -> String {
        self.path(key).to_string()
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
