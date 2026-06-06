use std::fmt;
use std::ops::RangeInclusive;

use canary_report::{Doc, Report, Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use smol_str::SmolStr;
use url::Url;

use crate::{Result, WorkerError};

/// Configuration for Canary's worker runtime.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct WorkerConfig {
    /// Temporal connection settings.
    pub temporal: TemporalConfig,
    /// Task queues used by each worker family.
    pub task_queues: TaskQueues,
    /// NATS JetStream settings for the claim-check codec.
    pub nats: NatsConfig,
    /// Payload codec settings.
    pub codec: CodecConfig,
}

impl Default for WorkerConfig {
    #[inline(always)]
    fn default() -> Self {
        Self {
            temporal: TemporalConfig::default(),
            task_queues: TaskQueues::default(),
            nats: NatsConfig::default(),
            codec: CodecConfig::default(),
        }
    }
}

impl WorkerConfig {
    /// Validates values that cannot be checked by Serde alone.
    ///
    /// This is intentionally light: commands may inspect configuration without
    /// connecting to Temporal or NATS.
    pub fn validate(&self) -> Result<()> {
        self.temporal.validate()?;
        self.task_queues.validate()?;
        self.nats.validate()?;
        self.codec.validate()
    }
}

impl Report for WorkerConfig {
    fn report(&self) -> Doc {
        Doc::builder()
            .section("workers", "Workers")
            .field("temporal", "temporal", self.temporal.target_url.as_str().to_owned())
            .field("namespace", "namespace", self.temporal.namespace.as_str().to_owned())
            .field(
                "workflow_queue",
                "workflow queue",
                self.task_queues.workflow.as_str().to_owned(),
            )
            .field(
                "rust_activities",
                "rust activities",
                self.task_queues.rust_activities.as_str().to_owned(),
            )
            .field(
                "python_activities",
                "python activities",
                self.task_queues.python_activities.as_str().to_owned(),
            )
            .field("nats", "nats", self.nats.url.as_str().to_owned())
            .field("object_store", "object store", self.nats.object_store.as_str().to_owned())
            .field(
                "claim_threshold",
                "claim threshold",
                Value::bytes(self.codec.claim_check_threshold_bytes as u64),
            )
            .build()
    }
}

/// Temporal service connection settings.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct TemporalConfig {
    /// Temporal frontend URL.
    pub target_url: Url,
    /// Temporal namespace used by Canary workflows.
    pub namespace: Namespace,
    /// Optional identity reported by this worker process.
    pub identity: Option<SmolStr>,
}

impl Default for TemporalConfig {
    #[inline(always)]
    fn default() -> Self {
        Self {
            target_url: Url::parse("http://127.0.0.1:7233").expect("default URL is valid"),
            namespace: Namespace::new("default").expect("default namespace is valid"),
            identity: None,
        }
    }
}

impl TemporalConfig {
    /// Validates the Temporal endpoint and namespace.
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.target_url.scheme(), "http" | "https") {
            return Err(WorkerError::Config(
                "workers.temporal.target_url must use http or https".to_owned(),
            ));
        }
        Ok(())
    }
}

/// NATS JetStream settings for large Temporal payloads.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct NatsConfig {
    /// NATS server URL.
    pub url: Url,
    /// Object-store bucket used by the claim-check codec.
    pub object_store: SmolStr,
    /// Optional JetStream domain.
    pub jetstream_domain: Option<SmolStr>,
}

impl Default for NatsConfig {
    #[inline(always)]
    fn default() -> Self {
        Self {
            url: Url::parse("nats://127.0.0.1:4222").expect("default URL is valid"),
            object_store: SmolStr::new("canary_temporal_payloads"),
            jetstream_domain: None,
        }
    }
}

impl NatsConfig {
    /// Validates the NATS URL and object-store bucket.
    pub fn validate(&self) -> Result<()> {
        if self.url.scheme() != "nats" {
            return Err(WorkerError::Config(
                "workers.nats.url must use the nats scheme".to_owned(),
            ));
        }
        if self.object_store.is_empty() {
            return Err(WorkerError::Config(
                "workers.nats.object_store must not be empty".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Claim-check payload codec settings.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct CodecConfig {
    /// Payloads at or above this encoded size move to JetStream Object Store.
    pub claim_check_threshold_bytes: usize,
}

impl Default for CodecConfig {
    #[inline(always)]
    fn default() -> Self {
        Self { claim_check_threshold_bytes: 65_536 }
    }
}

impl CodecConfig {
    /// Validates the codec threshold.
    pub fn validate(&self) -> Result<()> {
        if self.claim_check_threshold_bytes == 0 {
            return Err(WorkerError::Config(
                "workers.codec.claim_check_threshold_bytes must be greater than zero".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Task queues used by Canary worker families.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct TaskQueues {
    /// Queue used by Rust workflow workers.
    pub workflow: TaskQueue,
    /// Queue used by Rust activity workers.
    pub rust_activities: TaskQueue,
    /// Queue reserved for Python/docling activity workers.
    pub python_activities: TaskQueue,
}

impl Default for TaskQueues {
    #[inline(always)]
    fn default() -> Self {
        Self {
            workflow: TaskQueue::new("canary-workflows").expect("default queue is valid"),
            rust_activities: TaskQueue::new("canary-rust-activities")
                .expect("default queue is valid"),
            python_activities: TaskQueue::new("canary-python-activities")
                .expect("default queue is valid"),
        }
    }
}

impl TaskQueues {
    /// Validates all configured task queues.
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

/// Worker family selected by `canary worker run`.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkerKind {
    /// Workflow and Rust activity stubs.
    #[default]
    All,
    /// Rust workflow workers only.
    Workflow,
    /// Rust activity workers only.
    RustActivities,
    /// Future parser workers.
    Parser,
    /// Future ingestion workers.
    Ingestion,
    /// Future source workers.
    Source,
    /// Future embedding workers.
    Embedding,
}

/// A Temporal namespace.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct Namespace(SmolStr);

impl Namespace {
    /// Creates a namespace after checking it is non-empty.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(WorkerError::Config("Temporal namespace must not be empty".to_owned()));
        }
        Ok(Self(value))
    }

    /// Returns the namespace as a string slice.
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl TryFrom<String> for Namespace {
    type Error = WorkerError;

    #[inline(always)]
    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}

impl From<Namespace> for String {
    #[inline(always)]
    fn from(value: Namespace) -> Self {
        value.0.to_string()
    }
}

/// A Temporal task queue name.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct TaskQueue(SmolStr);

impl TaskQueue {
    /// Creates a task queue name.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(WorkerError::Config("Temporal task queue must not be empty".to_owned()));
        }
        Ok(Self(value))
    }

    /// Returns the task queue as a string slice.
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl TryFrom<String> for TaskQueue {
    type Error = WorkerError;

    #[inline(always)]
    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}

impl From<TaskQueue> for String {
    #[inline(always)]
    fn from(value: TaskQueue) -> Self {
        value.0.to_string()
    }
}

/// Key of a claimed payload inside JetStream Object Store.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct ClaimKey(SmolStr);

impl ClaimKey {
    /// Creates a key accepted by NATS Object Store.
    pub fn new(value: impl Into<SmolStr>) -> Result<Self> {
        let value = value.into();
        if value.is_empty() || value.starts_with('.') || value.ends_with('.') {
            return Err(WorkerError::Config("claim-check key is not valid".to_owned()));
        }
        if !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/' | '=' | '.'))
        {
            return Err(WorkerError::Config("claim-check key is not valid".to_owned()));
        }
        Ok(Self(value))
    }

    /// Builds a stable claim key from a SHA-256 digest.
    pub fn from_digest(digest: &ClaimDigest) -> Self {
        Self(SmolStr::new(format!("payloads/{}", digest.hex())))
    }

    /// Returns the key as a string slice.
    #[inline(always)]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl TryFrom<String> for ClaimKey {
    type Error = WorkerError;

    #[inline(always)]
    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}

impl From<ClaimKey> for String {
    #[inline(always)]
    fn from(value: ClaimKey) -> Self {
        value.0.to_string()
    }
}

/// SHA-256 digest of a claimed Temporal payload.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(try_from = "Vec<u8>", into = "Vec<u8>")]
pub struct ClaimDigest([u8; 32]);

impl ClaimDigest {
    /// Hashes a byte slice.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self(Sha256::digest(bytes).into())
    }

    /// Creates a digest from exactly 32 bytes.
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Returns the digest bytes.
    #[inline(always)]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Renders the digest as lowercase hex.
    pub fn hex(&self) -> String {
        const TABLE: &[u8; 16] = b"0123456789abcdef";
        let mut out = String::with_capacity(64);
        for byte in self.0 {
            out.push(TABLE[(byte >> 4) as usize] as char);
            out.push(TABLE[(byte & 0x0f) as usize] as char);
        }
        out
    }
}

impl fmt::Debug for ClaimDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}...", &self.hex()[..12])
    }
}

impl TryFrom<Vec<u8>> for ClaimDigest {
    type Error = WorkerError;

    fn try_from(value: Vec<u8>) -> Result<Self> {
        let bytes: [u8; 32] = value
            .try_into()
            .map_err(|_| WorkerError::Config("claim digest must be 32 bytes".to_owned()))?;
        Ok(Self(bytes))
    }
}

impl From<ClaimDigest> for Vec<u8> {
    #[inline(always)]
    fn from(value: ClaimDigest) -> Self {
        value.0.to_vec()
    }
}

/// Inclusive range of document ordinals handled by a child workflow.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(try_from = "RangeInclusive<u64>", into = "RangeInclusive<u64>")]
pub struct BatchRange(RangeInclusive<u64>);

impl BatchRange {
    /// Creates a range whose `start` is less than or equal to `end`.
    pub fn new(start: u64, end: u64) -> Result<Self> {
        if start == 0 || end < start {
            return Err(WorkerError::Config("batch ranges are one-based and inclusive".to_owned()));
        }
        Ok(Self(start..=end))
    }

    /// Splits a total document count into one-based inclusive ranges.
    pub fn split(total: u64, size: u64) -> Result<Vec<Self>> {
        if total == 0 || size == 0 {
            return Err(WorkerError::Config("batch totals and sizes must be non-zero".to_owned()));
        }
        let mut ranges = Vec::new();
        let mut start = 1;
        while start <= total {
            let end = start.saturating_add(size - 1).min(total);
            ranges.push(Self(start..=end));
            start = end.saturating_add(1);
        }
        Ok(ranges)
    }

    /// Returns the first document in the batch.
    #[inline(always)]
    pub fn start(&self) -> u64 {
        *self.0.start()
    }

    /// Returns the last document in the batch.
    #[inline(always)]
    pub fn end(&self) -> u64 {
        *self.0.end()
    }

    /// Returns the underlying inclusive Rust range.
    #[inline(always)]
    pub fn as_range(&self) -> &RangeInclusive<u64> {
        &self.0
    }

    /// Number of documents in the range.
    #[inline(always)]
    pub fn len(&self) -> u64 {
        self.end() - self.start() + 1
    }

    /// Returns whether the range contains no documents.
    ///
    /// A validated [`BatchRange`] is always non-empty, so this returns `false`.
    #[inline(always)]
    pub const fn is_empty(&self) -> bool {
        false
    }
}

impl TryFrom<RangeInclusive<u64>> for BatchRange {
    type Error = WorkerError;

    fn try_from(value: RangeInclusive<u64>) -> Result<Self> {
        Self::new(*value.start(), *value.end())
    }
}

impl From<BatchRange> for RangeInclusive<u64> {
    #[inline(always)]
    fn from(value: BatchRange) -> Self {
        value.0
    }
}

/// Maximum number of child workflows the parent keeps in flight.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub struct Lookahead(usize);

impl Lookahead {
    /// Creates a non-zero lookahead window.
    pub fn new(value: usize) -> Result<Self> {
        if value == 0 {
            return Err(WorkerError::Config("lookahead must be greater than zero".to_owned()));
        }
        Ok(Self(value))
    }

    /// Returns the window size.
    #[inline(always)]
    pub fn get(self) -> usize {
        self.0
    }
}

impl Default for Lookahead {
    #[inline(always)]
    fn default() -> Self {
        Self(4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_ranges_are_inclusive() {
        let ranges = BatchRange::split(10, 4).unwrap();
        assert_eq!(
            ranges,
            vec![
                BatchRange::new(1, 4).unwrap(),
                BatchRange::new(5, 8).unwrap(),
                BatchRange::new(9, 10).unwrap(),
            ]
        );
    }

    #[test]
    fn claim_digest_renders_hex() {
        let digest = ClaimDigest::from_bytes(b"canary");
        assert_eq!(digest.hex().len(), 64);
    }
}
