//! Stub workflows used to exercise Canary's Temporal worker surface.
//!
//! The workflows here are examples. They are intentionally small and
//! deterministic so they can prove worker registration, child workflow
//! fan-out/fan-in, and activity routing without doing domain work.

use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use futures::Stream;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use temporalio_common::error::ApplicationFailure;
use temporalio_common::protos::temporal::api::enums::v1::ParentClosePolicy;
use temporalio_macros::{workflow, workflow_methods};
use temporalio_sdk::{
    ActivityOptions, ChildWorkflowOptions, WorkflowContext, WorkflowResult, WorkflowTermination,
};

use crate::activities::{BatchSummary, DocumentActivities, FetchBatchInput, SummarizeBatchInput};
use crate::fanout::LookaheadExt;
use crate::{BatchRange, Lookahead, WorkerError};

/// Parent workflow that starts rolling child workflows and fans their results back in.
#[workflow]
#[derive(Default)]
pub struct DocumentFanoutWorkflow;

#[workflow_methods]
impl DocumentFanoutWorkflow {
    /// Runs the stub parent workflow.
    ///
    /// The scheduling is deterministic and rolling. The parent keeps up to
    /// `lookahead` child executions in flight and yields completed summaries
    /// in discovery order.
    #[run(name = "DocumentFanoutWorkflow")]
    pub async fn run(
        ctx: &mut WorkflowContext<Self>,
        input: DocumentFanoutInput,
    ) -> WorkflowResult<FanoutSummary> {
        let ctx = &*ctx;
        let queue = input.rust_activity_task_queue.clone();
        let batches = discover_batches(input.total_documents, input.batch_size)
            .map_err(workflow_config)?
            .windowed_lookahead(input.lookahead, |batch| {
                let queue = queue.clone();
                async move {
                    let child = ctx
                        .child_workflow(
                            DocumentBatchWorkflow::run,
                            DocumentBatchInput {
                                range: batch.range().clone(),
                                rust_activity_task_queue: queue,
                            },
                            ChildWorkflowOptions {
                                workflow_id: batch.workflow_id(),
                                parent_close_policy: ParentClosePolicy::Terminate,
                                ..Default::default()
                            },
                        )
                        .await?;
                    Ok::<BatchSummary, WorkflowTermination>(child.result().await?)
                }
            })
            .try_collect::<Vec<_>>()
            .await?;

        let documents = batches.iter().map(|batch| batch.documents).sum();
        Ok(FanoutSummary { documents, batches })
    }
}

/// Child workflow that runs the two Rust stub activities for one batch.
#[workflow]
#[derive(Default)]
pub struct DocumentBatchWorkflow;

#[workflow_methods]
impl DocumentBatchWorkflow {
    /// Runs the stub batch workflow.
    #[run(name = "DocumentBatchWorkflow")]
    pub async fn run(
        ctx: &mut WorkflowContext<Self>,
        input: DocumentBatchInput,
    ) -> WorkflowResult<BatchSummary> {
        let opts = || {
            ActivityOptions::with_start_to_close_timeout(Duration::from_secs(30))
                .task_queue(input.rust_activity_task_queue.clone())
                .build()
        };
        let batch = ctx
            .start_activity(
                DocumentActivities::fetch_batch_stub,
                FetchBatchInput { range: input.range },
                opts(),
            )
            .await
            .map_err(workflow_failure)?;
        ctx.start_activity(
            DocumentActivities::summarize_batch_stub,
            SummarizeBatchInput { batch },
            opts(),
        )
        .await
        .map_err(workflow_failure)
    }
}

/// Input accepted by the parent fan-out workflow.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DocumentFanoutInput {
    /// Total documents to split into child workflow batches.
    pub total_documents: u64,
    /// Number of documents assigned to each child workflow.
    pub batch_size: u64,
    /// Number of child workflows kept in flight per window.
    pub lookahead: Lookahead,
    /// Task queue used for Rust activities.
    pub rust_activity_task_queue: String,
}

/// Input accepted by the child batch workflow.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DocumentBatchInput {
    /// Document range handled by the child workflow.
    pub range: BatchRange,
    /// Task queue used for Rust activities.
    pub rust_activity_task_queue: String,
}

/// Summary returned by the parent fan-out workflow.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct FanoutSummary {
    /// Number of documents processed by all child workflows.
    pub documents: u64,
    /// Ordered summaries returned by child workflows.
    pub batches: Vec<BatchSummary>,
}

/// Creates the stub batch discovery stream used by the example workflow.
///
/// The current stub knows the total document count, but the workflow only
/// depends on the returned [`Stream`]. A paginated discovery activity can later
/// feed the same [`LookaheadExt::windowed_lookahead`] pipeline without changing
/// the fan-out code.
#[inline(always)]
fn discover_batches(total: u64, size: u64) -> crate::Result<BatchDiscovery> {
    BatchDiscovery::new(total, size)
}

/// Stream of document batches discovered for a parent workflow run.
#[derive(Debug, Clone)]
struct BatchDiscovery {
    total: u64,
    size: u64,
    next: u64,
    id: usize,
}

impl BatchDiscovery {
    /// Creates a lazy batch discovery stream.
    fn new(total: u64, size: u64) -> crate::Result<Self> {
        if total == 0 || size == 0 {
            return Err(WorkerError::Config("batch totals and sizes must be non-zero".to_owned()));
        }
        Ok(Self { total, size, next: 1, id: 0 })
    }
}

impl Stream for BatchDiscovery {
    type Item = DiscoveredBatch;

    fn poll_next(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if this.next > this.total {
            return Poll::Ready(None);
        }

        let start = this.next;
        let end = start.saturating_add(this.size - 1).min(this.total);
        let range = BatchRange::new(start, end).expect("batch discovery builds valid ranges");
        let batch = DiscoveredBatch { id: this.id, range };
        this.id += 1;
        this.next = end.saturating_add(1);
        Poll::Ready(Some(batch))
    }
}

/// Batch configuration yielded by discovery and passed into the fan-out map.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DiscoveredBatch {
    id: usize,
    range: BatchRange,
}

impl DiscoveredBatch {
    /// Stable identifier of this batch within the parent workflow run.
    #[inline(always)]
    fn id(&self) -> usize {
        self.id
    }

    /// Document range assigned to this batch.
    #[inline(always)]
    fn range(&self) -> &BatchRange {
        &self.range
    }

    /// Stable child workflow id for this batch.
    #[inline(always)]
    fn workflow_id(&self) -> String {
        format!("document-batch-{}-{}-{}", self.id(), self.range.start(), self.range.end())
    }
}

#[inline(always)]
fn workflow_config(err: impl Into<anyhow::Error>) -> WorkflowTermination {
    WorkflowTermination::failed_application(ApplicationFailure::non_retryable(err))
}

#[inline(always)]
fn workflow_failure(err: impl Into<anyhow::Error>) -> WorkflowTermination {
    WorkflowTermination::failed_application(ApplicationFailure::new(err))
}

#[cfg(test)]
mod tests {
    use futures_util::StreamExt;

    use super::*;

    #[test]
    fn discovery_streams_batches_lazily() {
        let batches = futures::executor::block_on(async {
            discover_batches(10, 4)
                .unwrap()
                .map(|batch| batch.range().clone())
                .collect::<Vec<_>>()
                .await
        });

        assert_eq!(
            batches,
            [
                BatchRange::new(1, 4).unwrap(),
                BatchRange::new(5, 8).unwrap(),
                BatchRange::new(9, 10).unwrap(),
            ]
        );
    }

    #[test]
    fn workflow_ids_are_stable() {
        let batch = futures::executor::block_on(async {
            discover_batches(3, 2).unwrap().next().await.unwrap()
        });

        assert_eq!(batch.id(), 0);
        assert_eq!(batch.workflow_id(), "document-batch-0-1-2");
    }
}
