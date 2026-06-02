use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use chrono::{TimeDelta, Utc};
use database::Database;
use tokio::sync::watch;

use crate::config::{BlobConfig, FilesConfig};
use crate::error::FileError;
use crate::files::events::UploadHub;
use crate::files::id::{FileId, UploadId};
use crate::files::list::ListBlobs;
use crate::files::meta::{BlobRecord, BlobSize, SampleCompleteness, StoredBlob};
use crate::files::repo::{BlobMetaRepo, InMemoryUploadRepo, SurrealBlobMetaRepo, UploadRepo};
use crate::files::sniff::classify;
use crate::files::store::{BlobHead, ObjectStorage};
use crate::files::upload::{
    ActorId, ChecksumEncoding, CompleteCmd, CompleteDirectPut, CompleteInput, CompleteMultipart,
    PartNumber, PartRequest, SignedUploadPart, UploadAccess, UploadChecksum, UploadDraft,
    UploadEventKind, UploadMode, UploadNotice, UploadSession, UploadState,
};
use crate::pagination::{Limit, Page, PageWindow};
use crate::{ChecksumAlgorithm, ChecksumKind};

#[derive(Clone)]
pub struct FileService {
    blobs: BlobService,
    uploads: UploadService,
}

#[derive(Debug, Clone)]
pub struct CreatedIntent {
    pub access: UploadAccess,
    pub session: UploadSession,
}

#[derive(Clone)]
pub struct BlobService {
    storage: Arc<ObjectStorage>,
    blobs: Arc<dyn BlobMetaRepo>,
    ttl: Duration,
}

#[derive(Clone)]
pub struct UploadService {
    storage: Arc<ObjectStorage>,
    blobs: Arc<dyn BlobMetaRepo>,
    cfg: BlobConfig,
    events: UploadHub,
    uploads: Arc<dyn UploadRepo>,
}

#[derive(Debug, Clone)]
pub struct DownloadAccess {
    pub url: String,
}

impl FileService {
    pub async fn new(cfg: FilesConfig, db: Database) -> Result<Self, FileError> {
        let storage = Arc::new(ObjectStorage::new(&cfg.storage).await?);
        let uploads_repo: Arc<dyn UploadRepo> = Arc::new(InMemoryUploadRepo::new());
        let blobs_repo: Arc<dyn BlobMetaRepo> = Arc::new(SurrealBlobMetaRepo::new(db));
        let blobs = BlobService {
            storage: Arc::clone(&storage),
            blobs: Arc::clone(&blobs_repo),
            ttl: cfg.uploads.presign_ttl,
        };
        let uploads = UploadService {
            storage,
            blobs: blobs_repo,
            cfg: cfg.uploads,
            events: UploadHub::new(),
            uploads: uploads_repo,
        };
        Ok(Self { blobs, uploads })
    }

    #[must_use]
    pub fn blobs(&self) -> BlobService {
        self.blobs.clone()
    }

    #[must_use]
    pub fn uploads(&self) -> UploadService {
        self.uploads.clone()
    }

    pub fn list(&self, limit: Limit) -> ListBlobs {
        self.blobs.list(limit)
    }
}

impl BlobService {
    pub async fn access(&self, id: FileId) -> Result<DownloadAccess, FileError> {
        let meta = self.blobs.head_ready(id).await?;
        Ok(DownloadAccess {
            url: self
                .storage
                .sign_get(
                    &meta.key,
                    meta.kind.serving().content_type(&meta.kind.effective),
                    file_name(&meta),
                    self.ttl,
                )
                .await?,
        })
    }

    pub async fn head(&self, id: FileId) -> Result<StoredBlob, FileError> {
        self.blobs.head_ready(id).await
    }

    pub fn list(&self, limit: Limit) -> ListBlobs {
        ListBlobs::new(self.clone(), limit)
    }

    pub(crate) async fn list_page(
        &self,
        window: PageWindow<FileId>,
    ) -> Result<Page<BlobRecord, FileId>, FileError> {
        self.blobs.list_ready_page(window).await
    }
}

impl UploadService {
    pub async fn create_intent(&self, draft: UploadDraft) -> Result<CreatedIntent, FileError> {
        let now = Utc::now();
        self.purge_expired(now).await?;
        self.validate_draft(&draft)?;
        let expires_at =
            now + TimeDelta::from_std(self.cfg.intent_ttl).expect("intent ttl is valid");
        let id = UploadId::new();
        let file = FileId::new();
        let common = draft.into_common(id, file, expires_at);
        let session = match self.mode(common.declared_size()) {
            UploadMode::DirectPut => UploadSession::direct_put(common),
            UploadMode::DirectMultipart => UploadSession::multipart(common),
        };
        let session = self.uploads.create(session).await?;
        let access = self.access_for(&session).await?;
        self.publish(UploadEventKind::Created, session.clone()).await;
        Ok(CreatedIntent { access, session })
    }

    pub async fn get(&self, actor: &ActorId, id: UploadId) -> Result<UploadSession, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        let session = self.refresh(session).await?;
        self.ensure_visible(&session)?;
        Ok(session)
    }

    pub async fn subscribe(
        &self,
        actor: &ActorId,
        id: UploadId,
    ) -> Result<(UploadSession, watch::Receiver<UploadNotice>), FileError> {
        let session = self.get(actor, id).await?;
        let rx = self.events.subscribe(session.clone()).await;
        Ok((session, rx))
    }

    pub async fn refresh_access(
        &self,
        actor: &ActorId,
        id: UploadId,
    ) -> Result<UploadAccess, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if session.mode() != UploadMode::DirectPut {
            return Err(FileError::UploadInvalidState { id, state: session.state() });
        }
        let session = self.refresh(session).await?;
        let access = self.access_for(&session).await?;
        self.publish(UploadEventKind::AccessRefreshed, session).await;
        Ok(access)
    }

    pub async fn sign_parts(
        &self,
        actor: &ActorId,
        id: UploadId,
        input: PartRequest,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if session.mode() != UploadMode::DirectMultipart {
            return Err(FileError::UploadInvalidState { id, state: session.state() });
        }
        self.normalize_parts(&input.parts)?;
        let session = if session.multipart_upload_id().is_some() {
            session
        } else {
            let next = self
                .storage
                .create_multipart(
                    session.staging_key(),
                    session.declared_type(),
                    self.multipart_checksum(),
                )
                .await?;
            let session = self.uploads.attach_multipart(id, next.id).await?;
            self.publish(UploadEventKind::Uploading, session.clone()).await;
            session
        };
        let upload_id = session.multipart_upload_id().ok_or(FileError::UploadIncomplete)?.clone();
        self.storage
            .sign_parts(session.staging_key(), &upload_id, &input.parts, self.cfg.presign_ttl)
            .await
    }

    pub async fn complete(
        &self,
        actor: &ActorId,
        id: UploadId,
        input: CompleteInput,
    ) -> Result<StoredBlob, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if session.state() == UploadState::Ready {
            return session.actual().cloned().ok_or(FileError::UploadIncomplete);
        }
        let session = self.refresh(session).await?;
        match self.complete_cmd(&session, input)? {
            CompleteCmd::DirectPut(cmd) => self.complete_direct_put(session, cmd).await,
            CompleteCmd::Multipart(cmd) => self.complete_multipart(session, cmd).await,
        }
    }

    pub async fn abort(&self, actor: &ActorId, id: UploadId) -> Result<UploadSession, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if matches!(session.state(), UploadState::Ready | UploadState::Deleted) {
            return Err(FileError::UploadInvalidState { id, state: session.state() });
        }
        let session = self.delete_upload(session, UploadState::Deleted).await?;
        self.publish(UploadEventKind::Deleted, session.clone()).await;
        Ok(session)
    }

    pub async fn sweep_expired(&self) -> Result<(), FileError> {
        self.purge_expired(Utc::now()).await
    }

    #[must_use]
    pub fn sweep_interval(&self) -> Duration {
        (self.cfg.intent_ttl / 2).clamp(Duration::from_secs(5), Duration::from_secs(300))
    }

    fn validate_draft(&self, draft: &UploadDraft) -> Result<(), FileError> {
        let size = draft.declared_size.get();
        if size > self.cfg.max_bytes {
            return Err(FileError::UploadTooLarge);
        }
        let max = self
            .cfg
            .multipart_part_size_bytes
            .saturating_mul(u64::from(self.cfg.multipart_max_parts));
        if size > max {
            return Err(FileError::UploadTooLarge);
        }
        if size <= self.cfg.multipart_threshold_bytes && draft.sha256.is_none() {
            return Err(FileError::UploadChecksumRequired {
                algorithm: ChecksumAlgorithm::Sha256,
                kind: ChecksumKind::FullObject,
            });
        }
        Ok(())
    }

    fn mode(&self, size: BlobSize) -> UploadMode {
        if size.get() > self.cfg.multipart_threshold_bytes {
            return UploadMode::DirectMultipart;
        }
        UploadMode::DirectPut
    }

    async fn access_for(&self, session: &UploadSession) -> Result<UploadAccess, FileError> {
        match session.mode() {
            UploadMode::DirectPut => Ok(UploadAccess::DirectPut(
                self.storage
                    .sign_put(
                        session.staging_key(),
                        session.declared_type(),
                        session.sha256(),
                        self.cfg.presign_ttl,
                    )
                    .await?,
            )),
            UploadMode::DirectMultipart => {
                Ok(UploadAccess::Multipart(crate::files::upload::MultipartAccess {
                    part_size_bytes: self.cfg.multipart_part_size_bytes,
                    max_parts: self.cfg.multipart_max_parts,
                    checksum: self.multipart_checksum(),
                }))
            }
        }
    }

    fn normalize_parts(
        &self,
        parts: &[crate::files::upload::RequestedUploadPart],
    ) -> Result<Vec<PartNumber>, FileError> {
        if parts.is_empty() {
            return Err(FileError::InvalidUploadParts);
        }
        let mut seen = BTreeSet::new();
        let mut out = Vec::with_capacity(parts.len());
        for part in parts {
            if part.checksum.trim().is_empty() {
                return Err(FileError::UploadChecksumRequired {
                    algorithm: self.multipart_checksum().algorithm,
                    kind: self.multipart_checksum().kind,
                });
            }
            if part.number.get() > self.cfg.multipart_max_parts || !seen.insert(part.number) {
                return Err(FileError::InvalidUploadParts);
            }
            out.push(part.number);
        }
        Ok(out)
    }

    fn ensure_owner(&self, session: &UploadSession, actor: &ActorId) -> Result<(), FileError> {
        if session.actor() == actor {
            return Ok(());
        }
        Err(FileError::UploadForbidden { id: session.id() })
    }

    fn ensure_visible(&self, session: &UploadSession) -> Result<(), FileError> {
        if session.state() == UploadState::Expired || session.is_expired(Utc::now()) {
            return Err(FileError::UploadExpired { id: session.id() });
        }
        Ok(())
    }

    fn ensure_active(&self, session: &UploadSession) -> Result<(), FileError> {
        self.ensure_visible(session)?;
        if matches!(session.state(), UploadState::Failed | UploadState::Deleted) {
            return Err(FileError::UploadInvalidState { id: session.id(), state: session.state() });
        }
        Ok(())
    }

    async fn purge_expired(&self, now: chrono::DateTime<Utc>) -> Result<(), FileError> {
        for session in self.uploads.expired(now).await? {
            let session = self.delete_upload(session, UploadState::Expired).await?;
            self.publish(UploadEventKind::Expired, session).await;
        }
        Ok(())
    }

    async fn refresh(&self, session: UploadSession) -> Result<UploadSession, FileError> {
        if session.mode() != UploadMode::DirectMultipart {
            return Ok(session);
        }
        if !matches!(session.state(), UploadState::Created | UploadState::Uploading) {
            return Ok(session);
        }
        let Some(upload_id) = session.multipart_upload_id().cloned() else {
            return Ok(session);
        };
        let next = self
            .storage
            .list_multipart_parts(session.staging_key(), &upload_id)
            .await?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let current = session.uploaded_parts().into_iter().collect::<BTreeSet<_>>();
        if next == current {
            return Ok(session);
        }
        let session = self.uploads.record_parts(session.id(), next).await?;
        self.publish(UploadEventKind::Uploading, session.clone()).await;
        Ok(session)
    }

    fn complete_cmd(
        &self,
        session: &UploadSession,
        input: CompleteInput,
    ) -> Result<CompleteCmd, FileError> {
        match session.mode() {
            UploadMode::DirectPut => {
                if !input.parts.is_empty() {
                    return Err(FileError::InvalidUploadParts);
                }
                Ok(CompleteCmd::DirectPut(CompleteDirectPut { etag: input.etag }))
            }
            UploadMode::DirectMultipart => Ok(CompleteCmd::Multipart(CompleteMultipart {
                etag: input.etag,
                checksum: input.checksum.filter(|value| !value.trim().is_empty()).ok_or(
                    FileError::UploadChecksumRequired {
                        algorithm: self.multipart_checksum().algorithm,
                        kind: self.multipart_checksum().kind,
                    },
                )?,
                parts: input.parts,
            })),
        }
    }

    async fn complete_direct_put(
        &self,
        session: UploadSession,
        cmd: CompleteDirectPut,
    ) -> Result<StoredBlob, FileError> {
        self.finalize_remote(session, cmd.etag, None).await
    }

    async fn complete_multipart(
        &self,
        session: UploadSession,
        cmd: CompleteMultipart,
    ) -> Result<StoredBlob, FileError> {
        if session.state() == UploadState::Created && session.multipart_upload_id().is_none() {
            return Err(FileError::UploadIncomplete);
        }
        let parts = self
            .normalize_parts(
                &cmd.parts
                    .iter()
                    .map(|part| crate::files::upload::RequestedUploadPart {
                        number: part.number,
                        checksum: part.checksum.clone(),
                    })
                    .collect::<Vec<_>>(),
            )?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let session = self.refresh(session).await?;
        let Some(upload_id) = session.multipart_upload_id().cloned() else {
            return Err(FileError::UploadIncomplete);
        };
        let uploaded = session.uploaded_parts().into_iter().collect::<BTreeSet<_>>();
        if parts.iter().any(|part| !uploaded.contains(part)) {
            return Err(FileError::UploadIncomplete);
        }
        if let Err(err) = self
            .storage
            .complete_multipart(
                session.staging_key(),
                &upload_id,
                cmd.checksum.as_str(),
                session.declared_size().get(),
                &cmd.parts,
            )
            .await
        {
            self.fail(session.clone()).await?;
            return Err(err);
        }
        self.finalize_remote(session, cmd.etag, Some(cmd.checksum.as_str())).await
    }

    async fn inspect_remote_blob(
        &self,
        session: &UploadSession,
        etag: Option<String>,
    ) -> Result<StoredBlob, FileError> {
        let head = self.storage.head_staging(session.staging_key()).await?;
        self.ensure_size(session, &head)?;
        let sniff = self.storage.peek_staging(session.staging_key(), self.cfg.sniff_bytes).await?;
        Ok(StoredBlob {
            id: session.file_id(),
            key: session.ready_key().clone(),
            name: session.name().cloned(),
            size: BlobSize::new(head.size),
            checksum: head.checksum,
            kind: classify(
                session.purpose().media_profile(),
                session.declared_type().cloned(),
                sniff.as_ref(),
                remote_sample(head.size, sniff.len()),
            )
            .into_result()?,
            etag: etag.or(head.etag),
            version: head.version,
        })
    }

    fn ensure_size(&self, session: &UploadSession, head: &BlobHead) -> Result<(), FileError> {
        if head.size != session.declared_size().get() {
            return Err(FileError::SizeMismatch);
        }
        Ok(())
    }

    async fn finish(
        &self,
        session: UploadSession,
        mut blob: StoredBlob,
    ) -> Result<StoredBlob, FileError> {
        let head = self
            .storage
            .promote(session.staging_key(), session.ready_key(), blob.kind.effective.as_str())
            .await?;
        blob.etag = head.etag.or(blob.etag);
        blob.version = head.version.or(blob.version);
        let blob = self.blobs.put_ready(blob).await?;
        let session = self.uploads.mark_ready(session.id(), blob.clone(), Utc::now()).await?;
        self.publish(UploadEventKind::Completed, session).await;
        Ok(blob)
    }

    async fn finalize_remote(
        &self,
        session: UploadSession,
        etag: Option<String>,
        checksum: Option<&str>,
    ) -> Result<StoredBlob, FileError> {
        let blob = match self.inspect_remote_blob(&session, etag).await {
            Ok(blob) => blob,
            Err(err) => {
                self.fail(session.clone()).await?;
                return Err(err);
            }
        };
        if let Err(err) = self.ensure_checksum(&session, &blob, checksum) {
            self.fail(session.clone()).await?;
            return Err(err);
        }
        self.finish(session, blob).await
    }

    async fn fail(&self, session: UploadSession) -> Result<(), FileError> {
        let session = self.delete_upload(session, UploadState::Failed).await?;
        self.publish(UploadEventKind::Failed, session).await;
        Ok(())
    }

    async fn delete_upload(
        &self,
        session: UploadSession,
        state: UploadState,
    ) -> Result<UploadSession, FileError> {
        if let Some(upload_id) = session.multipart_upload_id()
            && let Err(source) =
                self.storage.abort_multipart(session.staging_key(), upload_id).await
        {
            tracing::warn!(
                %source,
                upload_id = %session.id(),
                multipart_upload_id = %upload_id,
                "failed to abort multipart upload",
            );
        }
        if let Err(source) = self.storage.delete_staging(session.staging_key()).await {
            tracing::warn!(%source, upload_id = %session.id(), "failed to clean object");
        }
        let _ = self.blobs.delete_ready(session.file_id()).await;
        let when = Utc::now();
        let next = match state {
            UploadState::Failed => self.uploads.mark_failed(session.id(), when).await?,
            UploadState::Expired => self.uploads.mark_expired(session.id(), when).await?,
            UploadState::Deleted => self.uploads.mark_deleted(session.id(), when).await?,
            _ => return Err(FileError::UploadInvalidState { id: session.id(), state }),
        };
        Ok(next)
    }

    async fn publish(&self, kind: UploadEventKind, session: UploadSession) {
        self.events.publish(kind, session).await;
    }
    fn multipart_checksum(&self) -> UploadChecksum {
        UploadChecksum {
            algorithm: ChecksumAlgorithm::Crc64Nvme,
            kind: ChecksumKind::FullObject,
            encoding: ChecksumEncoding::Base64,
        }
    }

    fn ensure_checksum(
        &self,
        session: &UploadSession,
        blob: &StoredBlob,
        checksum: Option<&str>,
    ) -> Result<(), FileError> {
        match session.mode() {
            UploadMode::DirectPut => {
                let Some(sha256) = session.sha256() else {
                    return Err(FileError::UploadChecksumRequired {
                        algorithm: ChecksumAlgorithm::Sha256,
                        kind: ChecksumKind::FullObject,
                    });
                };
                if blob.checksum.as_ref().is_some_and(|value| value.matches_sha256(sha256)) {
                    return Ok(());
                }
                Err(FileError::ChecksumMismatch)
            }
            UploadMode::DirectMultipart => {
                let Some(value) = checksum else {
                    return Err(FileError::UploadChecksumRequired {
                        algorithm: self.multipart_checksum().algorithm,
                        kind: self.multipart_checksum().kind,
                    });
                };
                let required = self.multipart_checksum();
                if blob.checksum.as_ref().is_some_and(|found| {
                    found.algorithm == required.algorithm
                        && found.kind == required.kind
                        && found.value == value
                }) {
                    return Ok(());
                }
                Err(FileError::ChecksumMismatch)
            }
        }
    }
}

fn file_name(blob: &StoredBlob) -> &str {
    blob.name.as_ref().map(|name| name.as_str()).unwrap_or("download.bin")
}

fn remote_sample(size: u64, len: usize) -> SampleCompleteness {
    if size == 0 {
        return SampleCompleteness::Empty;
    }
    if size <= len as u64 {
        return SampleCompleteness::Complete;
    }
    SampleCompleteness::Prefix
}
