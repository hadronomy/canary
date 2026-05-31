use std::fmt;
use std::str::FromStr;

use base64::Engine;
use mime::Mime;
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;
use uuid::Uuid;

use crate::error::FileError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BlobId(Uuid);

impl BlobId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for BlobId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for BlobId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for BlobId {
    type Err = FileError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self).map_err(|_| FileError::InvalidBlobId)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobName(SmolStr);

impl BlobName {
    pub fn new(value: impl Into<SmolStr>) -> Result<Self, FileError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(FileError::InvalidFileName);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BlobSize(u64);

impl BlobSize {
    #[must_use]
    pub fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub fn get(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sha256Digest([u8; 32]);

impl Sha256Digest {
    #[must_use]
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn from_hex(value: &str) -> Result<Self, FileError> {
        if value.len() != 64 {
            return Err(FileError::InvalidChecksum);
        }

        let mut bytes = [0; 32];
        for (idx, slot) in bytes.iter_mut().enumerate() {
            let start = idx * 2;
            let end = start + 2;
            let byte = u8::from_str_radix(&value[start..end], 16)
                .map_err(|_| FileError::InvalidChecksum)?;
            *slot = byte;
        }

        Ok(Self(bytes))
    }

    #[must_use]
    pub fn to_hex(&self) -> String {
        let mut out = String::with_capacity(64);
        for byte in self.0 {
            use std::fmt::Write;
            let _ = write!(&mut out, "{byte:02x}");
        }
        out
    }

    #[must_use]
    pub fn to_base64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumAlgorithm {
    Sha256,
    Crc32c,
    Crc64Nvme,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumKind {
    FullObject,
    Composite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecksumVerifier {
    Server,
    Storage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobChecksum {
    pub algorithm: ChecksumAlgorithm,
    pub value: String,
    pub kind: ChecksumKind,
    pub verifier: ChecksumVerifier,
}

impl BlobChecksum {
    #[must_use]
    pub fn new(
        algorithm: ChecksumAlgorithm,
        value: impl Into<String>,
        kind: ChecksumKind,
        verifier: ChecksumVerifier,
    ) -> Self {
        Self { algorithm, value: value.into(), kind, verifier }
    }

    #[must_use]
    pub fn sha256_server(value: &Sha256Digest) -> Self {
        Self::new(
            ChecksumAlgorithm::Sha256,
            value.to_base64(),
            ChecksumKind::FullObject,
            ChecksumVerifier::Server,
        )
    }

    #[must_use]
    pub fn matches_sha256(&self, value: &Sha256Digest) -> bool {
        self.algorithm == ChecksumAlgorithm::Sha256
            && self.kind == ChecksumKind::FullObject
            && self.value == value.to_base64()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaProfile {
    Attachment,
}

impl MediaProfile {
    #[must_use]
    pub fn serving(self, media: &BlobMedia) -> ServingPolicy {
        match (self, media.risk()) {
            (Self::Attachment, MediaRisk::Active) => {
                ServingPolicy::attachment(ServingContent::Binary)
            }
            (Self::Attachment, MediaRisk::Passive | MediaRisk::Unknown) => {
                ServingPolicy::attachment(ServingContent::Effective)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SampleCompleteness {
    Empty,
    Complete,
    Prefix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionSource {
    MagicBytes,
    Utf8Text,
    HtmlHeuristic,
    XmlHeuristic,
    SvgHeuristic,
    JsonHeuristic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionConfidence {
    Strong,
    Heuristic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaRisk {
    Passive,
    Active,
    Unknown,
}

impl MediaRisk {
    #[must_use]
    pub fn of(mime: &Mime) -> Self {
        match (mime.type_(), mime.subtype().as_str(), mime.suffix().map(|value| value.as_str())) {
            (mime::TEXT, "html", _)
            | (mime::TEXT, "xml", _)
            | (mime::TEXT, "javascript", _)
            | (mime::TEXT, "ecmascript", _)
            | (mime::APPLICATION, "javascript", _)
            | (mime::APPLICATION, "ecmascript", _)
            | (mime::APPLICATION, "xml", _)
            | (mime::APPLICATION, _, Some("xml"))
            | (mime::IMAGE, "svg", Some("xml")) => Self::Active,
            _ => Self::Passive,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedMedia {
    pub mime: Mime,
    pub source: DetectionSource,
    pub confidence: DetectionConfidence,
}

impl DetectedMedia {
    #[must_use]
    pub fn new(mime: Mime, source: DetectionSource, confidence: DetectionConfidence) -> Self {
        Self { mime, source, confidence }
    }

    #[must_use]
    pub fn risk(&self) -> MediaRisk {
        MediaRisk::of(&self.mime)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionStateKind {
    Known,
    Possible,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectionState {
    Known(DetectedMedia),
    Possible(DetectedMedia),
    Missing,
}

impl DetectionState {
    #[must_use]
    pub fn kind(&self) -> DetectionStateKind {
        match self {
            Self::Known(_) => DetectionStateKind::Known,
            Self::Possible(_) => DetectionStateKind::Possible,
            Self::Missing => DetectionStateKind::Missing,
        }
    }

    #[must_use]
    pub fn media(&self) -> Option<&DetectedMedia> {
        match self {
            Self::Known(media) | Self::Possible(media) => Some(media),
            Self::Missing => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobObservation {
    pub declared: Option<Mime>,
    pub detection: DetectionState,
    pub sample: SampleCompleteness,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobMedia {
    Known(Mime),
    Unknown,
}

impl BlobMedia {
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Known(mime) => mime.as_ref(),
            Self::Unknown => mime::APPLICATION_OCTET_STREAM.as_ref(),
        }
    }

    #[must_use]
    pub fn risk(&self) -> MediaRisk {
        match self {
            Self::Known(mime) => MediaRisk::of(mime),
            Self::Unknown => MediaRisk::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationNeed {
    PrefixInspection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationState {
    Verified,
    NeedsInspection(ValidationNeed),
}

#[derive(Debug)]
pub enum UploadDecision {
    Accept(BlobKind),
    Review(BlobKind),
    Reject(FileError),
}

impl UploadDecision {
    pub fn into_result(self) -> Result<BlobKind, FileError> {
        match self {
            Self::Accept(kind) | Self::Review(kind) => Ok(kind),
            Self::Reject(err) => Err(err),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServingDisposition {
    Attachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServingContent {
    Effective,
    Binary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServingPolicy {
    pub disposition: ServingDisposition,
    pub content: ServingContent,
}

impl ServingPolicy {
    #[must_use]
    pub fn attachment(content: ServingContent) -> Self {
        Self { disposition: ServingDisposition::Attachment, content }
    }

    #[must_use]
    pub fn content_type<'a>(&self, media: &'a BlobMedia) -> &'a str {
        match self.content {
            ServingContent::Effective => media.as_str(),
            ServingContent::Binary => mime::APPLICATION_OCTET_STREAM.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobKind {
    pub profile: MediaProfile,
    pub observed: BlobObservation,
    pub effective: BlobMedia,
    pub validation: ValidationState,
}

impl BlobKind {
    #[must_use]
    pub fn risk(&self) -> MediaRisk {
        self.effective.risk()
    }

    #[must_use]
    pub fn serving(&self) -> ServingPolicy {
        self.profile.serving(&self.effective)
    }

    #[must_use]
    pub fn detected(&self) -> Option<&DetectedMedia> {
        self.observed.detection.media()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobKey(SmolStr);

impl BlobKey {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn from_id(id: BlobId) -> Self {
        Self::new(id.to_string())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagingKey(BlobKey);

impl StagingKey {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(BlobKey::new(value))
    }

    #[must_use]
    pub fn from_id(id: BlobId) -> Self {
        Self::new(format!("staging/upload/{id}/object"))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    #[must_use]
    pub fn blob(&self) -> &BlobKey {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyKey(BlobKey);

impl ReadyKey {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(BlobKey::new(value))
    }

    #[must_use]
    pub fn from_id(id: BlobId) -> Self {
        Self::new(format!("ready/blob/{id}/original"))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    #[must_use]
    pub fn blob(&self) -> &BlobKey {
        &self.0
    }
}

#[derive(Debug, Clone)]
pub struct StoredBlob {
    pub id: BlobId,
    pub key: ReadyKey,
    pub name: Option<BlobName>,
    pub size: BlobSize,
    pub checksum: Option<BlobChecksum>,
    pub kind: BlobKind,
    pub etag: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobRecord {
    pub id: String,
    pub name: Option<String>,
    pub size_bytes: u64,
    pub checksum: Option<BlobChecksum>,
    pub media_type: String,
    pub declared_media_type: Option<String>,
    pub sniffed_media_type: Option<String>,
}

impl From<&StoredBlob> for BlobRecord {
    fn from(value: &StoredBlob) -> Self {
        Self {
            id: value.id.to_string(),
            name: value.name.as_ref().map(|name| name.as_str().to_owned()),
            size_bytes: value.size.get(),
            checksum: value.checksum.clone(),
            media_type: value.kind.effective.as_str().to_owned(),
            declared_media_type: value.kind.observed.declared.as_ref().map(ToString::to_string),
            sniffed_media_type: value.kind.detected().map(|detected| detected.mime.to_string()),
        }
    }
}
