//! Semantic MCP response values shared by multiple tools.

use serde::Serialize;
use thiserror::Error;

/// Normalized progress for asynchronous work.
///
/// A progress value is finite and lies between zero and one, inclusive.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct Progress(f32);

impl Progress {
    /// Creates a normalized progress value.
    ///
    /// # Errors
    ///
    /// Returns [`ProgressError::OutOfRange`] when `value` is not finite or
    /// lies outside the inclusive `0.0..=1.0` range.
    pub fn new(value: f32) -> Result<Self, ProgressError> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(ProgressError::OutOfRange);
        }
        Ok(Self(value))
    }

    /// Returns the normalized progress value.
    #[must_use]
    #[inline(always)]
    pub const fn get(self) -> f32 {
        self.0
    }
}

/// Error returned when normalized progress is outside its valid range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ProgressError {
    /// The value is non-finite or outside `0.0..=1.0`.
    #[error("progress must be finite and between zero and one")]
    OutOfRange,
}

/// Current indexing state for one document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, rmcp::schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentState {
    /// The document exists but has not started normalization.
    Pending,

    /// The document is being normalized, chunked, or indexed.
    Processing,

    /// The document is available for retrieval.
    Ready,

    /// Processing stopped with an error.
    Failed,
}

/// Current lifecycle state for one ingestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, rmcp::schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IngestionState {
    /// The ingestion is waiting for a worker.
    Queued,

    /// The ingestion is actively processing documents.
    Running,

    /// The ingestion finished successfully.
    Completed,

    /// The ingestion stopped with an error.
    Failed,

    /// The ingestion was cancelled before completion.
    Cancelled,
}

/// Current lifecycle state for one durable operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, rmcp::schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationState {
    /// The server accepted the operation for asynchronous processing.
    Accepted,

    /// The operation is actively running.
    Running,

    /// The operation finished successfully.
    Completed,

    /// The operation stopped with an error.
    Failed,

    /// The operation was cancelled before completion.
    Cancelled,
}

/// Current lifecycle state for one connector synchronization run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, rmcp::schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// The run is waiting for a worker.
    Queued,

    /// The connector is actively synchronizing source items.
    Running,

    /// The synchronization finished successfully.
    Completed,

    /// The synchronization stopped with an error.
    Failed,

    /// The synchronization was cancelled before completion.
    Cancelled,
}
