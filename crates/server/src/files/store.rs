use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use object_store::path::Path as ObjectPath;
use object_store::{DynObjectStore, ObjectMeta};

use crate::config::S3FileConfig;
use crate::error::FileError;
use crate::files::direct::{MultipartSession, S3DirectBackend, S3RuntimeConfig};
use crate::files::meta::{BlobChecksum, BlobKey, ReadyKey, Sha256Digest, StagingKey};
use crate::files::upload::{
    CompletedUploadPart, DirectPutAccess, MultipartUploadId, PartNumber, RequestedUploadPart,
    SignedUploadPart, UploadChecksum,
};

#[derive(Debug, Clone)]
pub(crate) struct BlobHead {
    pub(crate) size: u64,
    pub(crate) etag: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) checksum: Option<BlobChecksum>,
}

#[derive(Clone)]
pub(crate) struct ObjectStorage {
    bytes: ObjectBytes,
    direct: S3DirectBackend,
}

#[derive(Clone)]
struct ObjectBytes {
    prefix: Option<String>,
    store: Arc<DynObjectStore>,
}

impl ObjectStorage {
    pub(crate) async fn new(cfg: &S3FileConfig) -> Result<Self, FileError> {
        let runtime = S3RuntimeConfig::from_file(cfg);
        let store = runtime
            .object_store_builder()
            .build()
            .map_err(|source| FileError::Store { source: Box::new(source) })?;
        Ok(Self {
            bytes: ObjectBytes {
                prefix: runtime.prefix().map(ToOwned::to_owned),
                store: Arc::new(store),
            },
            direct: S3DirectBackend::new(&runtime).await?,
        })
    }

    pub(crate) async fn sign_get(
        &self,
        key: &ReadyKey,
        ty: &str,
        name: &str,
        expires: Duration,
    ) -> Result<String, FileError> {
        self.direct.sign_get(self.bytes.object_key(key.blob()).as_str(), ty, name, expires).await
    }

    pub(crate) async fn head_staging(&self, key: &StagingKey) -> Result<BlobHead, FileError> {
        self.direct.head(self.bytes.object_key(key.blob()).as_str()).await
    }

    pub(crate) async fn peek_staging(
        &self,
        key: &StagingKey,
        len: usize,
    ) -> Result<Bytes, FileError> {
        self.bytes.peek_staging(key, len).await
    }

    pub(crate) async fn delete_staging(&self, key: &StagingKey) -> Result<(), FileError> {
        self.bytes.delete_staging(key).await
    }

    /// Promotes a validated upload from staging into the ready namespace.
    ///
    /// Uploads always land under staging keys first. Only after the server has
    /// inspected and accepted the bytes do they move into a ready key that the
    /// rest of the system can serve. Promotion also canonicalizes
    /// `Content-Type` so the stored object metadata matches Canary's validated
    /// media decision.
    pub(crate) async fn promote(
        &self,
        from: &StagingKey,
        to: &ReadyKey,
        ty: &str,
    ) -> Result<BlobHead, FileError> {
        self.direct
            .promote(
                self.bytes.object_key(from.blob()).as_str(),
                self.bytes.object_key(to.blob()).as_str(),
                ty,
            )
            .await?;
        self.bytes.head_ready(to).await
    }

    pub(crate) async fn sign_put(
        &self,
        key: &StagingKey,
        ty: Option<&mime::Mime>,
        sha256: Option<&Sha256Digest>,
        expires: std::time::Duration,
    ) -> Result<DirectPutAccess, FileError> {
        self.direct.sign_put(self.bytes.object_key(key.blob()).as_str(), ty, sha256, expires).await
    }

    pub(crate) async fn create_multipart(
        &self,
        key: &StagingKey,
        ty: Option<&mime::Mime>,
        checksum: UploadChecksum,
    ) -> Result<MultipartSession, FileError> {
        self.direct.create_multipart(self.bytes.object_key(key.blob()).as_str(), ty, checksum).await
    }

    pub(crate) async fn sign_parts(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
        parts: &[RequestedUploadPart],
        expires: Duration,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        self.direct
            .sign_parts(self.bytes.object_key(key.blob()).as_str(), upload_id, parts, expires)
            .await
    }

    pub(crate) async fn list_multipart_parts(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
    ) -> Result<Vec<PartNumber>, FileError> {
        self.direct.list_parts(self.bytes.object_key(key.blob()).as_str(), upload_id).await
    }

    pub(crate) async fn complete_multipart(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
        checksum: &str,
        size: u64,
        parts: &[CompletedUploadPart],
    ) -> Result<(), FileError> {
        self.direct
            .complete_multipart(
                self.bytes.object_key(key.blob()).as_str(),
                upload_id,
                checksum,
                size,
                parts,
            )
            .await
    }

    pub(crate) async fn abort_multipart(
        &self,
        key: &StagingKey,
        upload_id: &MultipartUploadId,
    ) -> Result<(), FileError> {
        self.direct.abort_multipart(self.bytes.object_key(key.blob()).as_str(), upload_id).await
    }
}

impl ObjectBytes {
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
