use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

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
pub struct BlobHash([u8; 32]);

impl BlobHash {
    #[must_use]
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobKind {
    pub declared: Option<Mime>,
    pub sniffed: Option<Mime>,
    pub effective: BlobMedia,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobKey(SmolStr);

impl BlobKey {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Clone)]
pub struct StagedBlob {
    pub id: BlobId,
    pub name: Option<BlobName>,
    pub size: BlobSize,
    pub hash: BlobHash,
    pub kind: BlobKind,
    pub path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StoredBlob {
    pub id: BlobId,
    pub key: BlobKey,
    pub name: Option<BlobName>,
    pub size: BlobSize,
    pub hash: BlobHash,
    pub kind: BlobKind,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobRecord {
    pub id: String,
    pub name: Option<String>,
    pub size_bytes: u64,
    pub hash_sha256: String,
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
            hash_sha256: value.hash.to_hex(),
            media_type: value.kind.effective.as_str().to_owned(),
            declared_media_type: value.kind.declared.as_ref().map(ToString::to_string),
            sniffed_media_type: value.kind.sniffed.as_ref().map(ToString::to_string),
        }
    }
}
