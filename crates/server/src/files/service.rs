use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use chrono::{TimeDelta, Utc};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

use crate::config::{BlobConfig, FilesConfig};
use crate::db::service::DatabaseService;
use crate::error::FileError;
use crate::files::events::UploadHub;
use crate::files::list::ListBlobs;
use crate::files::meta::{BlobHash, BlobId, BlobRecord, BlobSize, SampleCompleteness, StoredBlob};
use crate::files::repo::{BlobMetaRepo, InMemoryUploadRepo, SurrealBlobMetaRepo, UploadRepo};
use crate::files::sniff::classify;
use crate::files::store::{Backend, BlobHead, BlobRead};
use crate::files::upload::{
    ActorId, CompleteCmd, CompleteDirectPut, CompleteInput, CompleteMultipart, CompleteProxy,
    PartNumber, PartRequest, ProxyAccess, SignedUploadPart, UploadAccess, UploadDraft,
    UploadEventKind, UploadMode, UploadNotice, UploadSession, UploadState,
};
use crate::pagination::{Limit, Page, PageWindow};

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
    backend: Arc<Backend>,
    blobs: Arc<dyn BlobMetaRepo>,
}

#[derive(Clone)]
pub struct UploadService {
    backend: Arc<Backend>,
    blobs: Arc<dyn BlobMetaRepo>,
    cfg: BlobConfig,
    events: UploadHub,
    uploads: Arc<dyn UploadRepo>,
}

impl FileService {
    pub async fn new(cfg: FilesConfig, db: DatabaseService) -> Result<Self, FileError> {
        let backend = Arc::new(Backend::new(&cfg.backend, cfg.uploads.chunk_size_bytes).await?);
        let uploads_repo: Arc<dyn UploadRepo> = Arc::new(InMemoryUploadRepo::new());
        let blobs_repo: Arc<dyn BlobMetaRepo> = Arc::new(SurrealBlobMetaRepo::new(db));
        let blobs = BlobService { backend: Arc::clone(&backend), blobs: Arc::clone(&blobs_repo) };
        let uploads = UploadService {
            backend,
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
    pub async fn get(&self, id: BlobId) -> Result<(StoredBlob, BlobRead), FileError> {
        let meta = self.blobs.head_ready(id).await?;
        let body = self.backend.open(&meta).await?;
        Ok((meta, body))
    }

    pub async fn head(&self, id: BlobId) -> Result<StoredBlob, FileError> {
        self.blobs.head_ready(id).await
    }

    pub fn list(&self, limit: Limit) -> ListBlobs {
        ListBlobs::new(self.clone(), limit)
    }

    pub(crate) async fn list_page(
        &self,
        window: PageWindow<BlobId>,
    ) -> Result<Page<BlobRecord, BlobId>, FileError> {
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
        let id = BlobId::new();
        let common = draft.into_common(id, expires_at);
        let session = match self.mode(common.declared_size(), common.declared_hash()) {
            UploadMode::ProxyPut => UploadSession::proxy(common),
            UploadMode::DirectPut => UploadSession::direct_put(common),
            UploadMode::DirectMultipart => UploadSession::multipart(common),
        };
        let session = self.uploads.create(session).await?;
        let access = self.access_for(&session).await?;
        self.publish(UploadEventKind::Created, session.clone()).await;
        Ok(CreatedIntent { access, session })
    }

    pub async fn get(&self, actor: &ActorId, id: BlobId) -> Result<UploadSession, FileError> {
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
        id: BlobId,
    ) -> Result<(UploadSession, watch::Receiver<UploadNotice>), FileError> {
        let session = self.get(actor, id).await?;
        let rx = self.events.subscribe(session.clone()).await;
        Ok((session, rx))
    }

    pub async fn refresh_access(
        &self,
        actor: &ActorId,
        id: BlobId,
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
        id: BlobId,
        input: PartRequest,
    ) -> Result<Vec<SignedUploadPart>, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if session.mode() != UploadMode::DirectMultipart {
            return Err(FileError::UploadInvalidState { id, state: session.state() });
        }
        let parts = self.normalize_parts(&input.parts)?;
        let session = if session.multipart_upload_id().is_some() {
            session
        } else {
            let next = self
                .backend
                .create_multipart(session.staging_key(), session.declared_type())
                .await?;
            let session = self.uploads.attach_multipart(id, next.id).await?;
            self.publish(UploadEventKind::Uploading, session.clone()).await;
            session
        };
        let upload_id = session.multipart_upload_id().ok_or(FileError::UploadIncomplete)?.clone();
        self.backend
            .sign_parts(session.staging_key(), &upload_id, &parts, self.cfg.presign_ttl)
            .await
    }

    pub async fn put_body(
        &self,
        actor: &ActorId,
        id: BlobId,
        body: Body,
    ) -> Result<UploadSession, FileError> {
        self.purge_expired(Utc::now()).await?;
        let session = self.uploads.get(id).await?;
        self.ensure_owner(&session, actor)?;
        self.ensure_active(&session)?;
        if session.mode() != UploadMode::ProxyPut || session.state() != UploadState::Created {
            return Err(FileError::UploadInvalidState { id, state: session.state() });
        }
        let session = self.uploads.begin_upload(id).await?;
        self.publish(UploadEventKind::Uploading, session.clone()).await;

        let limit = session.declared_size().get().min(self.cfg.max_bytes);
        let mut hasher = Sha256::new();
        let mut sniff = Vec::with_capacity(self.cfg.sniff_bytes);
        let mut prefix = Vec::new();
        let mut size = 0u64;
        let mut stream = body.into_data_stream();
        let mut done = false;

        while sniff.len() < self.cfg.sniff_bytes {
            let Some(chunk) = stream.next().await else {
                done = true;
                break;
            };
            let chunk = chunk.map_err(|source| FileError::ReadBody { source: Box::new(source) })?;
            size += chunk.len() as u64;
            if size > limit {
                self.fail(session.clone()).await?;
                return Err(FileError::UploadTooLarge);
            }
            hasher.update(&chunk);
            let take = (self.cfg.sniff_bytes - sniff.len()).min(chunk.len());
            sniff.extend_from_slice(&chunk[..take]);
            prefix.push(chunk);
        }

        let decision = classify(
            session.purpose().media_profile(),
            session.declared_type().cloned(),
            &sniff,
            proxy_sample(sniff.len(), done),
        );
        let kind = match decision.into_result() {
            Ok(kind) => kind,
            Err(err) => {
                self.fail(session.clone()).await?;
                return Err(err);
            }
        };
        let mut write =
            self.backend.begin_write(session.staging_key(), kind.effective.as_str()).await?;
        for chunk in prefix {
            write.write_all(&chunk).await.map_err(|source| FileError::Persist { source })?;
        }
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|source| FileError::ReadBody { source: Box::new(source) })?;
            size += chunk.len() as u64;
            if size > limit {
                self.fail(session.clone()).await?;
                return Err(FileError::UploadTooLarge);
            }
            hasher.update(&chunk);
            write.write_all(&chunk).await.map_err(|source| FileError::Persist { source })?;
        }

        write.shutdown().await.map_err(|source| FileError::Persist { source })?;

        let blob = StoredBlob {
            id: session.id(),
            key: session.ready_key().clone(),
            name: session.name().cloned(),
            size: BlobSize::new(size),
            hash: Some(BlobHash::new(hasher.finalize().into())),
            kind,
            etag: None,
            version: None,
        };
        let session = self.uploads.mark_uploaded(id, blob).await?;
        self.publish(UploadEventKind::Uploaded, session.clone()).await;
        Ok(session)
    }

    pub async fn complete(
        &self,
        actor: &ActorId,
        id: BlobId,
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
            CompleteCmd::Proxy(cmd) => self.complete_proxy(session, cmd).await,
            CompleteCmd::DirectPut(cmd) => self.complete_direct_put(session, cmd).await,
            CompleteCmd::Multipart(cmd) => self.complete_multipart(session, cmd).await,
        }
    }

    pub async fn abort(&self, actor: &ActorId, id: BlobId) -> Result<UploadSession, FileError> {
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
        Ok(())
    }

    fn mode(&self, size: BlobSize, hash: Option<&BlobHash>) -> UploadMode {
        if !self.backend.supports_direct() || hash.is_some() {
            return UploadMode::ProxyPut;
        }
        if size.get() > self.cfg.multipart_threshold_bytes {
            return UploadMode::DirectMultipart;
        }
        UploadMode::DirectPut
    }

    async fn access_for(&self, session: &UploadSession) -> Result<UploadAccess, FileError> {
        match session.mode() {
            UploadMode::ProxyPut => Ok(UploadAccess::Proxy(ProxyAccess {
                max_bytes: session.declared_size().get().min(self.cfg.max_bytes),
            })),
            UploadMode::DirectPut => Ok(UploadAccess::DirectPut(
                self.backend
                    .sign_put(session.staging_key(), session.declared_type(), self.cfg.presign_ttl)
                    .await?,
            )),
            UploadMode::DirectMultipart => {
                Ok(UploadAccess::Multipart(crate::files::upload::MultipartAccess {
                    part_size_bytes: self.cfg.multipart_part_size_bytes,
                    max_parts: self.cfg.multipart_max_parts,
                }))
            }
        }
    }

    fn normalize_parts(&self, parts: &[PartNumber]) -> Result<Vec<PartNumber>, FileError> {
        if parts.is_empty() {
            return Err(FileError::InvalidUploadParts);
        }
        let mut seen = BTreeSet::new();
        let mut out = Vec::with_capacity(parts.len());
        for &part in parts {
            if part.get() > self.cfg.multipart_max_parts || !seen.insert(part) {
                return Err(FileError::InvalidUploadParts);
            }
            out.push(part);
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
            .backend
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
            UploadMode::ProxyPut => {
                if !input.parts.is_empty() {
                    return Err(FileError::InvalidUploadParts);
                }
                Ok(CompleteCmd::Proxy(CompleteProxy { etag: input.etag, hash: input.hash }))
            }
            UploadMode::DirectPut => {
                if !input.parts.is_empty() {
                    return Err(FileError::InvalidUploadParts);
                }
                Ok(CompleteCmd::DirectPut(CompleteDirectPut { etag: input.etag }))
            }
            UploadMode::DirectMultipart => Ok(CompleteCmd::Multipart(CompleteMultipart {
                etag: input.etag,
                parts: input.parts,
            })),
        }
    }

    async fn complete_proxy(
        &self,
        session: UploadSession,
        cmd: CompleteProxy,
    ) -> Result<StoredBlob, FileError> {
        if session.state() != UploadState::Uploaded {
            return Err(FileError::UploadInvalidState { id: session.id(), state: session.state() });
        }
        let head = match self.backend.head_staging(session.staging_key()).await {
            Ok(head) => head,
            Err(err) => {
                self.fail(session.clone()).await?;
                return Err(err);
            }
        };
        let mut blob = match session.actual().cloned() {
            Some(blob) => blob,
            None => {
                self.fail(session.clone()).await?;
                return Err(FileError::UploadIncomplete);
            }
        };
        if blob.size != session.declared_size() || head.size != blob.size.get() {
            self.fail(session.clone()).await?;
            return Err(FileError::SizeMismatch);
        }
        if let Some(hash) = session.declared_hash()
            && blob.hash.as_ref() != Some(hash)
        {
            self.fail(session.clone()).await?;
            return Err(FileError::ChecksumMismatch);
        }
        if let Some(hash) = cmd.hash.as_ref()
            && blob.hash.as_ref() != Some(hash)
        {
            self.fail(session.clone()).await?;
            return Err(FileError::ChecksumMismatch);
        }
        blob.etag = cmd.etag.or(head.etag);
        blob.version = head.version;
        self.finish(session, blob).await
    }

    async fn complete_direct_put(
        &self,
        session: UploadSession,
        cmd: CompleteDirectPut,
    ) -> Result<StoredBlob, FileError> {
        self.finalize_remote(session, cmd.etag).await
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
            .normalize_parts(&cmd.parts.iter().map(|part| part.number).collect::<Vec<_>>())?
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
        if let Err(err) =
            self.backend.complete_multipart(session.staging_key(), &upload_id, &cmd.parts).await
        {
            self.fail(session.clone()).await?;
            return Err(err);
        }
        self.finalize_remote(session, cmd.etag).await
    }

    async fn inspect_remote_blob(
        &self,
        session: &UploadSession,
        etag: Option<String>,
    ) -> Result<StoredBlob, FileError> {
        let head = self.backend.head_staging(session.staging_key()).await?;
        self.ensure_size(session, &head)?;
        let sniff = self.backend.peek_staging(session.staging_key(), self.cfg.sniff_bytes).await?;
        Ok(StoredBlob {
            id: session.id(),
            key: session.ready_key().clone(),
            name: session.name().cloned(),
            size: BlobSize::new(head.size),
            hash: None,
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
            .backend
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
    ) -> Result<StoredBlob, FileError> {
        let blob = match self.inspect_remote_blob(&session, etag).await {
            Ok(blob) => blob,
            Err(err) => {
                self.fail(session.clone()).await?;
                return Err(err);
            }
        };
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
                self.backend.abort_multipart(session.staging_key(), upload_id).await
        {
            tracing::warn!(
                %source,
                upload_id = %session.id(),
                multipart_upload_id = %upload_id,
                "failed to abort multipart upload",
            );
        }
        if let Err(source) = self.backend.delete_staging(session.staging_key()).await {
            tracing::warn!(%source, upload_id = %session.id(), "failed to clean object");
        }
        let _ = self.blobs.delete_ready(session.id()).await;
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
}

fn proxy_sample(len: usize, done: bool) -> SampleCompleteness {
    if len == 0 {
        return SampleCompleteness::Empty;
    }
    if done {
        return SampleCompleteness::Complete;
    }
    SampleCompleteness::Prefix
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
