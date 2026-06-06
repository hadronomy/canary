//! Stub activities registered by the Rust activity worker.
//!
//! These activities are examples. They compile, register, and make the
//! workflow examples executable, but they are not the final BOE fetching,
//! docling, parsing, embedding, or persistence activities.

use serde::{Deserialize, Serialize};
use temporalio_macros::activities;
use temporalio_sdk::activities::{ActivityContext, ActivityError};

use crate::BatchRange;

/// Activity set registered by the Rust activity worker.
#[derive(Debug, Clone, Default)]
pub struct DocumentActivities;

#[activities]
impl DocumentActivities {
    /// Pretends to fetch a batch of source documents.
    ///
    /// The real implementation will live in a future domain activity and will
    /// perform network and storage work outside workflow code.
    #[activity(name = "fetch_batch_stub")]
    pub async fn fetch_batch_stub(
        ctx: ActivityContext,
        input: FetchBatchInput,
    ) -> Result<FetchedBatch, ActivityError> {
        if ctx.is_cancelled() {
            return Err(ActivityError::cancelled());
        }
        let range = input.range;
        let documents = range.len();
        Ok(FetchedBatch { range, documents })
    }

    /// Pretends to summarize the result of a fetched document batch.
    ///
    /// This is deliberately boring. Its job is to prove activity registration
    /// and fan-in wiring, not to model the final document pipeline.
    #[activity(name = "summarize_batch_stub")]
    pub async fn summarize_batch_stub(
        ctx: ActivityContext,
        input: SummarizeBatchInput,
    ) -> Result<BatchSummary, ActivityError> {
        if ctx.is_cancelled() {
            return Err(ActivityError::cancelled());
        }
        Ok(BatchSummary {
            range: input.batch.range,
            documents: input.batch.documents,
            note: "stub batch completed".to_owned(),
        })
    }
}

/// Input accepted by `fetch_batch_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct FetchBatchInput {
    /// Document range assigned to the child workflow.
    pub range: BatchRange,
}

/// Output produced by `fetch_batch_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct FetchedBatch {
    /// Document range fetched by the activity.
    pub range: BatchRange,
    /// Number of documents represented by this stub batch.
    pub documents: u64,
}

/// Input accepted by `summarize_batch_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SummarizeBatchInput {
    /// Batch returned by `fetch_batch_stub`.
    pub batch: FetchedBatch,
}

/// Output produced by `summarize_batch_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct BatchSummary {
    /// Document range covered by the child workflow.
    pub range: BatchRange,
    /// Number of documents represented by this stub summary.
    pub documents: u64,
    /// Human-readable stub note.
    pub note: String,
}
