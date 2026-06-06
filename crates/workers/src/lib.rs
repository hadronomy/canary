//! Temporal worker runtime support for Canary.
//!
//! This crate owns the worker-side pieces that do not belong in the HTTP
//! server: Temporal worker construction, stub workflows and activities, and
//! the claim-check payload codec used for large Temporal payloads.

pub mod activities;
pub mod codec;
pub mod config;
mod error;
pub mod fanout;
pub mod runtime;
pub mod workflows;

pub use config::{
    BatchRange, ClaimDigest, ClaimKey, CodecConfig, Lookahead, Namespace, NatsConfig, TaskQueue,
    TaskQueues, TemporalConfig, WorkerConfig, WorkerKind,
};
pub use error::{Result, WorkerError};
pub use runtime::{WorkerRuntime, WorkerRuntimeOptions};
