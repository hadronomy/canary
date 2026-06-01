use std::collections::BTreeSet;
use std::fmt;

use chrono::{DateTime, Utc};
use mime::Mime;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;

use crate::error::FileError;
use crate::files::id::{FileId, UploadId};
use crate::files::meta::{
    BlobName, BlobSize, ChecksumAlgorithm, ChecksumKind, MediaProfile, ReadyKey, Sha256Digest,
    StagingKey, StoredBlob,
};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ActorId(SmolStr);

impl ActorId {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, FileError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(FileError::InvalidActorId);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for ActorId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadPurpose(SmolStr);

impl UploadPurpose {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, FileError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(FileError::InvalidUploadPurpose);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn attachment() -> Self {
        Self(SmolStr::new_inline("attachment"))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    #[must_use]
    pub fn media_profile(&self) -> MediaProfile {
        MediaProfile::Attachment
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadMode {
    DirectPut,
    DirectMultipart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadState {
    Created,
    Uploading,
    Ready,
    Failed,
    Expired,
    Deleted,
}

impl fmt::Display for UploadState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Created => "created",
            Self::Uploading => "uploading",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Expired => "expired",
            Self::Deleted => "deleted",
        };
        f.write_str(text)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MultipartUploadId(SmolStr);

impl MultipartUploadId {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, FileError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(FileError::UploadIncomplete);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for MultipartUploadId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PartNumber(u16);

impl PartNumber {
    pub fn new(value: u16) -> Result<Self, FileError> {
        if value == 0 {
            return Err(FileError::InvalidUploadParts);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn get(self) -> u16 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadCommon {
    id: UploadId,
    file: FileId,
    actor: ActorId,
    purpose: UploadPurpose,
    staging: StagingKey,
    ready: ReadyKey,
    name: Option<BlobName>,
    declared_type: Option<Mime>,
    declared_size: BlobSize,
    sha256: Option<Sha256Digest>,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

impl UploadCommon {
    #[must_use]
    pub fn id(&self) -> UploadId {
        self.id
    }

    #[must_use]
    pub fn file_id(&self) -> FileId {
        self.file
    }

    #[must_use]
    pub fn actor(&self) -> &ActorId {
        &self.actor
    }

    #[must_use]
    pub fn purpose(&self) -> &UploadPurpose {
        &self.purpose
    }

    #[must_use]
    pub fn staging_key(&self) -> &StagingKey {
        &self.staging
    }

    #[must_use]
    pub fn ready_key(&self) -> &ReadyKey {
        &self.ready
    }

    #[must_use]
    pub fn name(&self) -> Option<&BlobName> {
        self.name.as_ref()
    }

    #[must_use]
    pub fn declared_type(&self) -> Option<&Mime> {
        self.declared_type.as_ref()
    }

    #[must_use]
    pub fn declared_size(&self) -> BlobSize {
        self.declared_size
    }

    #[must_use]
    pub fn sha256(&self) -> Option<&Sha256Digest> {
        self.sha256.as_ref()
    }

    #[must_use]
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    #[must_use]
    pub fn expires_at(&self) -> DateTime<Utc> {
        self.expires_at
    }
}

#[derive(Debug, Clone)]
pub struct UploadDraft {
    pub actor: ActorId,
    pub purpose: UploadPurpose,
    pub name: Option<BlobName>,
    pub declared_type: Option<Mime>,
    pub declared_size: BlobSize,
    pub sha256: Option<Sha256Digest>,
}

impl UploadDraft {
    #[must_use]
    pub fn into_common(
        self,
        id: UploadId,
        file: FileId,
        expires_at: DateTime<Utc>,
    ) -> UploadCommon {
        UploadCommon {
            id,
            file,
            actor: self.actor,
            purpose: self.purpose,
            staging: StagingKey::from_upload(id),
            ready: ReadyKey::from_file(file),
            name: self.name,
            declared_type: self.declared_type,
            declared_size: self.declared_size,
            sha256: self.sha256,
            created_at: Utc::now(),
            expires_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DirectPutUpload {
    common: UploadCommon,
    state: UploadState,
    actual: Option<StoredBlob>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub enum MultipartSession {
    Pending,
    Active { id: MultipartUploadId, parts: BTreeSet<PartNumber> },
}

#[derive(Debug, Clone)]
pub struct MultipartUpload {
    common: UploadCommon,
    state: UploadState,
    actual: Option<StoredBlob>,
    completed_at: Option<DateTime<Utc>>,
    session: MultipartSession,
}

#[derive(Debug, Clone)]
pub enum UploadSession {
    DirectPut(DirectPutUpload),
    Multipart(MultipartUpload),
}

impl UploadSession {
    #[must_use]
    pub fn direct_put(common: UploadCommon) -> Self {
        Self::DirectPut(DirectPutUpload {
            common,
            state: UploadState::Created,
            actual: None,
            completed_at: None,
        })
    }

    #[must_use]
    pub fn multipart(common: UploadCommon) -> Self {
        Self::Multipart(MultipartUpload {
            common,
            state: UploadState::Created,
            actual: None,
            completed_at: None,
            session: MultipartSession::Pending,
        })
    }

    #[must_use]
    pub fn id(&self) -> UploadId {
        self.common().id()
    }

    #[must_use]
    pub fn file_id(&self) -> FileId {
        self.common().file_id()
    }

    #[must_use]
    pub fn actor(&self) -> &ActorId {
        self.common().actor()
    }

    #[must_use]
    pub fn purpose(&self) -> &UploadPurpose {
        self.common().purpose()
    }

    #[must_use]
    pub fn staging_key(&self) -> &StagingKey {
        self.common().staging_key()
    }

    #[must_use]
    pub fn ready_key(&self) -> &ReadyKey {
        self.common().ready_key()
    }

    #[must_use]
    pub fn name(&self) -> Option<&BlobName> {
        self.common().name()
    }

    #[must_use]
    pub fn declared_type(&self) -> Option<&Mime> {
        self.common().declared_type()
    }

    #[must_use]
    pub fn declared_size(&self) -> BlobSize {
        self.common().declared_size()
    }

    #[must_use]
    pub fn sha256(&self) -> Option<&Sha256Digest> {
        self.common().sha256()
    }

    #[must_use]
    pub fn created_at(&self) -> DateTime<Utc> {
        self.common().created_at()
    }

    #[must_use]
    pub fn expires_at(&self) -> DateTime<Utc> {
        self.common().expires_at()
    }

    #[must_use]
    pub fn mode(&self) -> UploadMode {
        match self {
            Self::DirectPut(_) => UploadMode::DirectPut,
            Self::Multipart(_) => UploadMode::DirectMultipart,
        }
    }

    #[must_use]
    pub fn state(&self) -> UploadState {
        match self {
            Self::DirectPut(upload) => upload.state,
            Self::Multipart(upload) => upload.state,
        }
    }

    #[must_use]
    pub fn actual(&self) -> Option<&StoredBlob> {
        match self {
            Self::DirectPut(upload) => upload.actual.as_ref(),
            Self::Multipart(upload) => upload.actual.as_ref(),
        }
    }

    #[must_use]
    pub fn completed_at(&self) -> Option<DateTime<Utc>> {
        match self {
            Self::DirectPut(upload) => upload.completed_at,
            Self::Multipart(upload) => upload.completed_at,
        }
    }

    #[must_use]
    pub fn uploaded_parts(&self) -> Vec<PartNumber> {
        match self {
            Self::Multipart(upload) => match &upload.session {
                MultipartSession::Pending => Vec::new(),
                MultipartSession::Active { parts, .. } => parts.iter().copied().collect(),
            },
            _ => Vec::new(),
        }
    }

    #[must_use]
    pub fn multipart_upload_id(&self) -> Option<&MultipartUploadId> {
        match self {
            Self::Multipart(upload) => match &upload.session {
                MultipartSession::Pending => None,
                MultipartSession::Active { id, .. } => Some(id),
            },
            _ => None,
        }
    }

    #[must_use]
    pub fn size_bytes(&self) -> u64 {
        self.actual().map(|blob| blob.size.get()).unwrap_or_else(|| self.declared_size().get())
    }

    #[must_use]
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        !matches!(
            self.state(),
            UploadState::Ready | UploadState::Expired | UploadState::Failed | UploadState::Deleted
        ) && now >= self.expires_at()
    }

    pub fn attach_multipart(mut self, id: MultipartUploadId) -> Result<Self, FileError> {
        let Self::Multipart(upload) = &mut self else {
            return Err(FileError::UploadInvalidState { id: self.id(), state: self.state() });
        };
        upload.session = MultipartSession::Active { id, parts: BTreeSet::new() };
        if upload.state == UploadState::Created {
            upload.state = UploadState::Uploading;
        }
        Ok(self)
    }

    pub fn record_parts(mut self, next: BTreeSet<PartNumber>) -> Result<Self, FileError> {
        let Self::Multipart(upload) = &mut self else {
            return Err(FileError::UploadInvalidState { id: self.id(), state: self.state() });
        };
        let id = match &upload.session {
            MultipartSession::Pending => {
                return Err(FileError::UploadInvalidState { id: self.id(), state: self.state() });
            }
            MultipartSession::Active { id, .. } => id.clone(),
        };
        upload.session = MultipartSession::Active { id, parts: next };
        if upload.state == UploadState::Created {
            upload.state = UploadState::Uploading;
        }
        Ok(self)
    }

    #[must_use]
    pub fn mark_ready(mut self, blob: StoredBlob, when: DateTime<Utc>) -> Self {
        self.set_actual(Some(blob));
        self.set_state(UploadState::Ready);
        self.set_completed_at(Some(when));
        self
    }

    #[must_use]
    pub fn mark_failed(mut self, when: DateTime<Utc>) -> Self {
        self.set_state(UploadState::Failed);
        self.set_completed_at(Some(when));
        self
    }

    #[must_use]
    pub fn mark_expired(mut self, when: DateTime<Utc>) -> Self {
        self.set_state(UploadState::Expired);
        self.set_completed_at(Some(when));
        self
    }

    #[must_use]
    pub fn mark_deleted(mut self, when: DateTime<Utc>) -> Self {
        self.set_state(UploadState::Deleted);
        self.set_completed_at(Some(when));
        self
    }

    fn common(&self) -> &UploadCommon {
        match self {
            Self::DirectPut(upload) => &upload.common,
            Self::Multipart(upload) => &upload.common,
        }
    }

    fn set_state(&mut self, state: UploadState) {
        match self {
            Self::DirectPut(upload) => upload.state = state,
            Self::Multipart(upload) => upload.state = state,
        }
    }

    fn set_actual(&mut self, blob: Option<StoredBlob>) {
        match self {
            Self::DirectPut(upload) => upload.actual = blob,
            Self::Multipart(upload) => upload.actual = blob,
        }
    }

    fn set_completed_at(&mut self, when: Option<DateTime<Utc>>) {
        match self {
            Self::DirectPut(upload) => upload.completed_at = when,
            Self::Multipart(upload) => upload.completed_at = when,
        }
    }
}

#[derive(Debug, Clone)]
pub enum UploadAccess {
    DirectPut(DirectPutAccess),
    Multipart(MultipartAccess),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumEncoding {
    Base64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct UploadChecksum {
    pub algorithm: ChecksumAlgorithm,
    pub kind: ChecksumKind,
    pub encoding: ChecksumEncoding,
}

#[derive(Debug, Clone)]
pub struct DirectPutAccess {
    pub url: String,
    pub headers: Vec<UploadHeader>,
    pub checksum: UploadChecksum,
}

#[derive(Debug, Clone)]
pub struct MultipartAccess {
    pub part_size_bytes: u64,
    pub max_parts: u16,
    pub checksum: UploadChecksum,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SignedUploadPart {
    pub number: PartNumber,
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<UploadHeader>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartRequest {
    pub parts: Vec<RequestedUploadPart>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RequestedUploadPart {
    pub number: PartNumber,
    pub checksum: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompletedUploadPart {
    pub number: PartNumber,
    pub etag: String,
    pub checksum: String,
}

#[derive(Debug, Clone, Default)]
pub struct CompleteInput {
    pub etag: Option<String>,
    pub checksum: Option<String>,
    pub parts: Vec<CompletedUploadPart>,
}

#[derive(Debug, Clone)]
pub enum CompleteCmd {
    DirectPut(CompleteDirectPut),
    Multipart(CompleteMultipart),
}

#[derive(Debug, Clone)]
pub struct CompleteDirectPut {
    pub etag: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CompleteMultipart {
    pub etag: Option<String>,
    pub checksum: String,
    pub parts: Vec<CompletedUploadPart>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadEventKind {
    Snapshot,
    Created,
    AccessRefreshed,
    Uploading,
    Completed,
    Failed,
    Expired,
    Deleted,
}

impl UploadEventKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Snapshot => "upload.snapshot",
            Self::Created => "upload.created",
            Self::AccessRefreshed => "upload.access_refreshed",
            Self::Uploading => "upload.uploading",
            Self::Completed => "upload.completed",
            Self::Failed => "upload.failed",
            Self::Expired => "upload.expired",
            Self::Deleted => "upload.deleted",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UploadNotice {
    pub kind: UploadEventKind,
    pub session: UploadSession,
}
