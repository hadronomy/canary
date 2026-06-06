//! Temporal workflow entrypoints used by the worker runtime.
//!
//! Worker registration should be able to import workflow types from one place.
//! Each workflow family keeps its implementation in its own file, while this
//! module exposes the names the runtime needs to register. The document
//! workflows exported here are executable examples for the worker surface; they
//! do not model the final BOE or docling pipeline.

mod stubs;

pub use stubs::{
    DocumentBatchInput, DocumentBatchWorkflow, DocumentFanoutInput, DocumentFanoutWorkflow,
    FanoutSummary,
};
