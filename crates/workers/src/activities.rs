//! Stub activities registered by the Rust activity worker.
//!
//! These activities are examples. They compile, register, and make the worker
//! examples executable, but they are not the final BOE fetching, docling,
//! parsing, embedding, or persistence activities.

use serde::{Deserialize, Serialize};
use temporalio_macros::activities;
use temporalio_sdk::activities::{ActivityContext, ActivityError};
use tracing::info;

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
        let range = input.batch.range;
        let start = range.start();
        let end = range.end();
        Ok(BatchSummary {
            range,
            documents: input.batch.documents,
            note: format!(
                "demo batch {start}..{end} counted its tiny scrolls and returned in order"
            ),
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

/// Activity set used by the distributed math demo workflow.
#[derive(Debug, Clone, Default)]
pub struct MathActivities;

#[activities]
impl MathActivities {
    /// Computes a shard of the Leibniz series for π.
    ///
    /// This activity is intentionally CPU-bound and deterministic. It gives the
    /// demo a real fan-out job without smuggling future document-pipeline
    /// behavior into the example.
    #[activity(name = "sum_pi_shard_stub")]
    pub async fn sum_pi_shard_stub(
        ctx: ActivityContext,
        input: SumPiShardInput,
    ) -> Result<PiShardPartial, ActivityError> {
        if ctx.is_cancelled() {
            return Err(ActivityError::cancelled());
        }
        let range = input.range;
        let terms = range.len();
        let partial = leibniz(range.start(), range.end());
        info!(
            start = range.start(),
            end = range.end(),
            terms,
            partial,
            "computed distributed pi shard"
        );
        Ok(PiShardPartial { range, terms, partial })
    }

    /// Turns a computed shard into a small human-readable summary.
    #[activity(name = "describe_pi_shard_stub")]
    pub async fn describe_pi_shard_stub(
        ctx: ActivityContext,
        input: DescribePiShardInput,
    ) -> Result<PiShardSummary, ActivityError> {
        if ctx.is_cancelled() {
            return Err(ActivityError::cancelled());
        }
        let range = input.partial.range;
        let start = range.start();
        let end = range.end();
        let partial = input.partial.partial;
        info!(start, end, partial, "described distributed pi shard");
        Ok(PiShardSummary {
            range,
            terms: input.partial.terms,
            partial,
            note: format!("terms {start}..{end} sent back {partial:+.12}"),
        })
    }
}

/// Input accepted by `sum_pi_shard_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SumPiShardInput {
    /// One-based inclusive term range assigned to the child workflow.
    pub range: BatchRange,
}

/// Output produced by `sum_pi_shard_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct PiShardPartial {
    /// One-based inclusive term range summed by the activity.
    pub range: BatchRange,
    /// Number of Leibniz terms represented by the range.
    pub terms: u64,
    /// Partial sum before multiplying by four.
    pub partial: f64,
}

/// Input accepted by `describe_pi_shard_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct DescribePiShardInput {
    /// Computed shard returned by `sum_pi_shard_stub`.
    pub partial: PiShardPartial,
}

/// Output produced by `describe_pi_shard_stub`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct PiShardSummary {
    /// One-based inclusive term range covered by the child workflow.
    pub range: BatchRange,
    /// Number of terms computed by the shard.
    pub terms: u64,
    /// Partial sum before multiplying by four.
    pub partial: f64,
    /// Human-readable stub note.
    pub note: String,
}

/// Computes the Leibniz sum for a one-based inclusive term range.
#[inline(always)]
fn leibniz(start: u64, end: u64) -> f64 {
    (start..=end).fold(0.0, |sum, ordinal| {
        let idx = ordinal - 1;
        let term = 1.0 / ((idx * 2 + 1) as f64);
        if idx % 2 == 0 { sum + term } else { sum - term }
    })
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;

    use super::*;

    #[test]
    fn leibniz_matches_small_hand_sum() {
        let sum = leibniz(1, 4);
        let expected = 1.0 - (1.0 / 3.0) + (1.0 / 5.0) - (1.0 / 7.0);

        assert!((sum - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn leibniz_gets_close_to_pi_when_scaled() {
        let estimate = leibniz(1, 10_000) * 4.0;

        assert!((estimate - PI).abs() < 0.001);
    }
}
