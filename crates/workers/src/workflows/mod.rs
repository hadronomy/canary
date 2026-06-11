//! Temporal workflow entrypoints used by the worker runtime.
//!
//! Worker registration should be able to import workflow types from one place.
//! Each workflow family keeps its implementation in its own file, while this
//! module exposes the names the runtime needs to register. These workflows are
//! executable examples for the worker surface; they do not model the final BOE,
//! docling, or embedding pipeline.

mod math;
mod stubs;

pub use math::{
    DistributedPiInput, DistributedPiWorkflow, PiRunSummary, PiShardInput, PiShardWorkflow,
};
pub use stubs::{
    DocumentBatchInput, DocumentBatchWorkflow, DocumentFanoutInput, DocumentFanoutWorkflow,
    FanoutSummary,
};
