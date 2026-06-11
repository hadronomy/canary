//! Distributed math workflows used by the demo worker.
//!
//! These workflows are deliberately nerdy and deliberately temporary. They
//! show Temporal child workflows, activity routing, bounded fan-out, and
//! ordered fan-in without implying anything about the future document pipeline.

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

use crate::activities::{DescribePiShardInput, MathActivities, PiShardSummary, SumPiShardInput};
use crate::fanout::LookaheadExt;
use crate::{BatchRange, Lookahead, WorkerError};

/// Parent workflow that computes π through a bounded fan-out of child workflows.
#[workflow]
#[derive(Default)]
pub struct DistributedPiWorkflow;

#[workflow_methods]
impl DistributedPiWorkflow {
    /// Runs the distributed π demo.
    ///
    /// The parent discovers term ranges lazily, keeps at most `lookahead` child
    /// workflows in flight, and folds the returned partial sums in range order.
    #[run(name = "DistributedPiWorkflow")]
    pub async fn run(
        ctx: &mut WorkflowContext<Self>,
        input: DistributedPiInput,
    ) -> WorkflowResult<PiRunSummary> {
        let ctx = &*ctx;
        let queue = input.rust_activity_task_queue.clone();
        let shards = discover_terms(input.terms, input.shard_size)
            .map_err(workflow_config)?
            .windowed_lookahead(input.lookahead, |shard| {
                let queue = queue.clone();
                async move {
                    let child = ctx
                        .child_workflow(
                            PiShardWorkflow::run,
                            PiShardInput {
                                range: shard.range().clone(),
                                rust_activity_task_queue: queue,
                            },
                            ChildWorkflowOptions {
                                workflow_id: shard.workflow_id(),
                                parent_close_policy: ParentClosePolicy::Terminate,
                                ..Default::default()
                            },
                        )
                        .await?;
                    Ok::<PiShardSummary, WorkflowTermination>(child.result().await?)
                }
            })
            .try_collect::<Vec<_>>()
            .await?;

        let terms = shards.iter().map(|shard| shard.terms).sum();
        let sum = shards.iter().map(|shard| shard.partial).sum::<f64>();
        let estimate = sum * 4.0;
        let error = (estimate - std::f64::consts::PI).abs();
        let shard_count = shards.len();
        Ok(PiRunSummary {
            terms,
            shard_count,
            estimate,
            error,
            note: format!(
                "{terms} alternating terms fanned out across {shard_count} ordered shards"
            ),
            shards,
        })
    }
}

/// Child workflow that runs the two Rust activities for one π shard.
#[workflow]
#[derive(Default)]
pub struct PiShardWorkflow;

#[workflow_methods]
impl PiShardWorkflow {
    /// Runs one shard of the distributed π demo.
    #[run(name = "PiShardWorkflow")]
    pub async fn run(
        ctx: &mut WorkflowContext<Self>,
        input: PiShardInput,
    ) -> WorkflowResult<PiShardSummary> {
        let opts = || {
            ActivityOptions::with_start_to_close_timeout(Duration::from_secs(60))
                .task_queue(input.rust_activity_task_queue.clone())
                .build()
        };
        let partial = ctx
            .start_activity(
                MathActivities::sum_pi_shard_stub,
                SumPiShardInput { range: input.range },
                opts(),
            )
            .await
            .map_err(workflow_failure)?;
        ctx.start_activity(
            MathActivities::describe_pi_shard_stub,
            DescribePiShardInput { partial },
            opts(),
        )
        .await
        .map_err(workflow_failure)
    }
}

/// Input accepted by [`DistributedPiWorkflow`].
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DistributedPiInput {
    /// Number of Leibniz terms to compute.
    pub terms: u64,
    /// Number of terms assigned to each child workflow.
    pub shard_size: u64,
    /// Number of child workflows kept in flight per window.
    pub lookahead: Lookahead,
    /// Task queue used for Rust activities.
    pub rust_activity_task_queue: String,
}

/// Input accepted by [`PiShardWorkflow`].
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PiShardInput {
    /// One-based inclusive range of Leibniz terms handled by this shard.
    pub range: BatchRange,
    /// Task queue used for Rust activities.
    pub rust_activity_task_queue: String,
}

/// Summary returned by [`DistributedPiWorkflow`].
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct PiRunSummary {
    /// Number of Leibniz terms folded into the final estimate.
    pub terms: u64,
    /// Number of child workflow shards that participated.
    pub shard_count: usize,
    /// Approximation of π produced by the distributed run.
    pub estimate: f64,
    /// Absolute difference between `estimate` and `std::f64::consts::PI`.
    pub error: f64,
    /// Human-readable run note.
    pub note: String,
    /// Ordered child workflow summaries.
    pub shards: Vec<PiShardSummary>,
}

/// Creates the shard discovery stream used by the distributed π demo.
#[inline(always)]
fn discover_terms(total: u64, size: u64) -> crate::Result<TermDiscovery> {
    TermDiscovery::new(total, size)
}

/// Stream of term shards discovered for a parent workflow run.
#[derive(Debug, Clone)]
struct TermDiscovery {
    total: u64,
    size: u64,
    next: u64,
    id: usize,
}

impl TermDiscovery {
    /// Creates a lazy term discovery stream.
    fn new(total: u64, size: u64) -> crate::Result<Self> {
        if total == 0 || size == 0 {
            return Err(WorkerError::Config(
                "term totals and shard sizes must be non-zero".to_owned(),
            ));
        }
        Ok(Self { total, size, next: 1, id: 0 })
    }
}

impl Stream for TermDiscovery {
    type Item = TermShard;

    fn poll_next(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if this.next > this.total {
            return Poll::Ready(None);
        }

        let start = this.next;
        let end = start.saturating_add(this.size - 1).min(this.total);
        let range = BatchRange::new(start, end).expect("term discovery builds valid ranges");
        let shard = TermShard { id: this.id, range };
        this.id += 1;
        this.next = end.saturating_add(1);
        Poll::Ready(Some(shard))
    }
}

/// Term shard yielded by discovery and passed into the fan-out map.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TermShard {
    id: usize,
    range: BatchRange,
}

impl TermShard {
    /// Stable identifier of this shard within the parent workflow run.
    #[inline(always)]
    fn id(&self) -> usize {
        self.id
    }

    /// Term range assigned to this shard.
    #[inline(always)]
    fn range(&self) -> &BatchRange {
        &self.range
    }

    /// Stable child workflow id for this shard.
    #[inline(always)]
    fn workflow_id(&self) -> String {
        format!("pi-shard-{}-{}-{}", self.id(), self.range.start(), self.range.end())
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
    fn discovery_streams_term_shards_lazily() {
        let shards = futures::executor::block_on(async {
            discover_terms(10, 4)
                .unwrap()
                .map(|shard| shard.range().clone())
                .collect::<Vec<_>>()
                .await
        });

        assert_eq!(
            shards,
            [
                BatchRange::new(1, 4).unwrap(),
                BatchRange::new(5, 8).unwrap(),
                BatchRange::new(9, 10).unwrap(),
            ]
        );
    }

    #[test]
    fn workflow_ids_are_stable() {
        let shard = futures::executor::block_on(async {
            discover_terms(3, 2).unwrap().next().await.unwrap()
        });

        assert_eq!(shard.id(), 0);
        assert_eq!(shard.workflow_id(), "pi-shard-0-1-2");
    }
}
