use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::db::service::DatabaseService;
use crate::error::FileError;
use crate::files::meta::{
    BlobHash, BlobId, BlobKind, BlobMedia, BlobName, BlobObservation, BlobRecord, BlobSize,
    DetectedMedia, DetectionConfidence, DetectionSource, DetectionState, DetectionStateKind,
    MediaProfile, ReadyKey, SampleCompleteness, StoredBlob, ValidationState,
};
use crate::files::upload::{MultipartUploadId, PartNumber, UploadSession};
use crate::pagination::{Page, PageWindow};

#[async_trait]
pub trait UploadRepo: Send + Sync {
    async fn create(&self, session: UploadSession) -> Result<UploadSession, FileError>;
    async fn get(&self, id: BlobId) -> Result<UploadSession, FileError>;
    async fn expired(&self, now: DateTime<Utc>) -> Result<Vec<UploadSession>, FileError>;
    async fn begin_upload(&self, id: BlobId) -> Result<UploadSession, FileError>;
    async fn attach_multipart(
        &self,
        id: BlobId,
        upload_id: MultipartUploadId,
    ) -> Result<UploadSession, FileError>;
    async fn record_parts(
        &self,
        id: BlobId,
        parts: BTreeSet<PartNumber>,
    ) -> Result<UploadSession, FileError>;
    async fn mark_uploaded(&self, id: BlobId, blob: StoredBlob)
    -> Result<UploadSession, FileError>;
    async fn mark_ready(
        &self,
        id: BlobId,
        blob: StoredBlob,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError>;
    async fn mark_failed(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError>;
    async fn mark_expired(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError>;
    async fn mark_deleted(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError>;
}

#[async_trait]
pub trait BlobMetaRepo: Send + Sync {
    async fn put_ready(&self, blob: StoredBlob) -> Result<StoredBlob, FileError>;
    async fn delete_ready(&self, id: BlobId) -> Result<(), FileError>;
    async fn head_ready(&self, id: BlobId) -> Result<StoredBlob, FileError>;
    async fn list_ready_page(
        &self,
        window: PageWindow<BlobId>,
    ) -> Result<Page<BlobRecord, BlobId>, FileError>;
}

#[derive(Clone, Default)]
pub struct InMemoryUploadRepo {
    inner: Arc<RwLock<RepoState>>,
}

#[derive(Clone)]
pub struct SurrealBlobMetaRepo {
    db: DatabaseService,
}

#[derive(Default)]
struct RepoState {
    uploads: BTreeMap<BlobId, UploadSession>,
}

impl InMemoryUploadRepo {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn replace(
        state: &mut RepoState,
        id: BlobId,
        f: impl FnOnce(UploadSession) -> Result<UploadSession, FileError>,
    ) -> Result<UploadSession, FileError> {
        let Some(session) = state.uploads.remove(&id) else {
            return Err(FileError::UploadNotFound { id });
        };
        let next = f(session)?;
        state.uploads.insert(id, next.clone());
        Ok(next)
    }
}

impl SurrealBlobMetaRepo {
    #[must_use]
    pub fn new(db: DatabaseService) -> Self {
        Self { db }
    }
}

#[async_trait]
impl UploadRepo for InMemoryUploadRepo {
    async fn create(&self, session: UploadSession) -> Result<UploadSession, FileError> {
        self.inner.write().await.uploads.insert(session.id(), session.clone());
        Ok(session)
    }

    async fn get(&self, id: BlobId) -> Result<UploadSession, FileError> {
        let Some(session) = self.inner.read().await.uploads.get(&id).cloned() else {
            return Err(FileError::UploadNotFound { id });
        };
        Ok(session)
    }

    async fn expired(&self, now: DateTime<Utc>) -> Result<Vec<UploadSession>, FileError> {
        Ok(self
            .inner
            .read()
            .await
            .uploads
            .values()
            .filter(|session| session.is_expired(now))
            .cloned()
            .collect())
    }

    async fn begin_upload(&self, id: BlobId) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, UploadSession::begin_upload)
    }

    async fn attach_multipart(
        &self,
        id: BlobId,
        upload_id: MultipartUploadId,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| session.attach_multipart(upload_id))
    }

    async fn record_parts(
        &self,
        id: BlobId,
        parts: BTreeSet<PartNumber>,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| session.record_parts(parts))
    }

    async fn mark_uploaded(
        &self,
        id: BlobId,
        blob: StoredBlob,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| session.mark_uploaded(blob))
    }

    async fn mark_ready(
        &self,
        id: BlobId,
        blob: StoredBlob,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| Ok(session.mark_ready(blob, when)))
    }

    async fn mark_failed(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| Ok(session.mark_failed(when)))
    }

    async fn mark_expired(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| Ok(session.mark_expired(when)))
    }

    async fn mark_deleted(
        &self,
        id: BlobId,
        when: DateTime<Utc>,
    ) -> Result<UploadSession, FileError> {
        let mut state = self.inner.write().await;
        Self::replace(&mut state, id, |session| Ok(session.mark_deleted(when)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlobRow {
    cursor: String,
    key: String,
    name: Option<String>,
    size_bytes: u64,
    hash_sha256: Option<String>,
    media_profile: MediaProfile,
    media_type: String,
    declared_media_type: Option<String>,
    sniffed_media_type: Option<String>,
    sniffed_state: Option<DetectionStateKind>,
    sniffed_source: Option<DetectionSource>,
    sniffed_confidence: Option<DetectionConfidence>,
    sample_kind: SampleCompleteness,
    validation_state: ValidationState,
    etag: Option<String>,
    version: Option<String>,
}

impl From<&StoredBlob> for BlobRow {
    fn from(value: &StoredBlob) -> Self {
        Self {
            cursor: value.id.to_string(),
            key: value.key.as_str().to_owned(),
            name: value.name.as_ref().map(|name| name.as_str().to_owned()),
            size_bytes: value.size.get(),
            hash_sha256: value.hash.as_ref().map(BlobHash::to_hex),
            media_profile: value.kind.profile,
            media_type: value.kind.effective.as_str().to_owned(),
            declared_media_type: value.kind.observed.declared.as_ref().map(ToString::to_string),
            sniffed_media_type: value.kind.detected().map(|detected| detected.mime.to_string()),
            sniffed_state: match &value.kind.observed.detection {
                DetectionState::Missing => None,
                state => Some(state.kind()),
            },
            sniffed_source: value.kind.detected().map(|detected| detected.source),
            sniffed_confidence: value.kind.detected().map(|detected| detected.confidence),
            sample_kind: value.kind.observed.sample,
            validation_state: value.kind.validation,
            etag: value.etag.clone(),
            version: value.version.clone(),
        }
    }
}

impl TryFrom<BlobRow> for StoredBlob {
    type Error = FileError;

    fn try_from(value: BlobRow) -> Result<Self, Self::Error> {
        let id = BlobId::from_str(value.cursor.as_str())?;
        let declared =
            value.declared_media_type.as_deref().map(str::parse).transpose().map_err(meta_err)?;
        let detection = match (
            value.sniffed_media_type.as_deref(),
            value.sniffed_state,
            value.sniffed_source,
            value.sniffed_confidence,
        ) {
            (None, None, None, None) => DetectionState::Missing,
            (Some(mime), Some(state), Some(source), Some(confidence)) => match state {
                DetectionStateKind::Known => DetectionState::Known(DetectedMedia::new(
                    mime.parse().map_err(meta_err)?,
                    source,
                    confidence,
                )),
                DetectionStateKind::Possible => DetectionState::Possible(DetectedMedia::new(
                    mime.parse().map_err(meta_err)?,
                    source,
                    confidence,
                )),
                DetectionStateKind::Missing => DetectionState::Missing,
            },
            _ => {
                return Err(FileError::Metadata {
                    source: Box::new(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "incomplete sniffed metadata",
                    )),
                });
            }
        };
        let effective = match value.media_type.as_str() {
            ty if ty == mime::APPLICATION_OCTET_STREAM.as_ref() => BlobMedia::Unknown,
            _ => BlobMedia::Known(value.media_type.parse().map_err(meta_err)?),
        };
        Ok(Self {
            id,
            key: ReadyKey::new(value.key),
            name: value.name.map(BlobName::new).transpose()?,
            size: BlobSize::new(value.size_bytes),
            hash: value.hash_sha256.as_deref().map(BlobHash::from_hex).transpose()?,
            kind: BlobKind {
                profile: value.media_profile,
                observed: BlobObservation { declared, detection, sample: value.sample_kind },
                effective,
                validation: value.validation_state,
            },
            etag: value.etag,
            version: value.version,
        })
    }
}

#[async_trait]
impl BlobMetaRepo for SurrealBlobMetaRepo {
    async fn put_ready(&self, blob: StoredBlob) -> Result<StoredBlob, FileError> {
        let row = BlobRow::from(&blob);
        let _: Option<BlobRow> = self
            .db
            .client()
            .upsert(("file_blob", row.cursor.clone()))
            .content(row)
            .await
            .map_err(meta_err)?;
        Ok(blob)
    }

    async fn delete_ready(&self, id: BlobId) -> Result<(), FileError> {
        let _: Option<BlobRow> =
            self.db.client().delete(("file_blob", id.to_string())).await.map_err(meta_err)?;
        Ok(())
    }

    async fn head_ready(&self, id: BlobId) -> Result<StoredBlob, FileError> {
        let row: Option<BlobRow> =
            self.db.client().select(("file_blob", id.to_string())).await.map_err(meta_err)?;
        let Some(row) = row else {
            return Err(FileError::NotFound { id });
        };
        StoredBlob::try_from(row)
    }

    async fn list_ready_page(
        &self,
        window: PageWindow<BlobId>,
    ) -> Result<Page<BlobRecord, BlobId>, FileError> {
        let limit = window.limit().get() + 1;
        let mut query = if let Some(after) = window.after() {
            self.db
                .client()
                .query("SELECT * FROM file_blob WHERE cursor > $after ORDER BY cursor LIMIT $limit")
                .bind(("after", after.to_string()))
        } else {
            self.db.client().query("SELECT * FROM file_blob ORDER BY cursor LIMIT $limit")
        };
        query = query.bind(("limit", limit));
        let mut out = query.await.map_err(meta_err)?;
        let mut rows: Vec<BlobRow> = out.take(0).map_err(meta_err)?;
        let next = if rows.len() > window.limit().get() {
            rows.pop().map(|row| BlobId::from_str(row.cursor.as_str())).transpose()?
        } else {
            None
        };
        let items = rows
            .into_iter()
            .map(StoredBlob::try_from)
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .map(BlobRecord::from)
            .collect();
        Ok(Page::new(items, next))
    }
}

fn meta_err(source: impl std::error::Error + Send + Sync + 'static) -> FileError {
    FileError::Metadata { source: Box::new(source) }
}
