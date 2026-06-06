use miette::Diagnostic;
use thiserror::Error;

/// Result type used by the worker crate.
pub type Result<T> = std::result::Result<T, WorkerError>;

/// Errors raised while configuring or running Canary workers.
#[derive(Debug, Diagnostic, Error)]
pub enum WorkerError {
    /// A configuration value cannot be used safely.
    #[error("invalid worker configuration: {0}")]
    #[diagnostic(code(canary_workers::config))]
    Config(String),

    /// The selected worker kind is reserved for future domain workers.
    #[error("{0} workers are not implemented yet")]
    #[diagnostic(code(canary_workers::todo))]
    Todo(&'static str),

    /// Temporal connection setup failed.
    #[error("failed to connect to Temporal: {0}")]
    #[diagnostic(code(canary_workers::temporal_connect))]
    TemporalConnect(String),

    /// Temporal worker setup failed.
    #[error("failed to build Temporal worker: {0}")]
    #[diagnostic(code(canary_workers::temporal_worker))]
    TemporalWorker(String),

    /// A Temporal worker stopped with an error.
    #[error("Temporal worker failed: {0}")]
    #[diagnostic(code(canary_workers::temporal_run))]
    TemporalRun(String),

    /// NATS connection setup failed.
    #[error("failed to connect to NATS: {0}")]
    #[diagnostic(code(canary_workers::nats_connect))]
    NatsConnect(String),

    /// JetStream object-store setup failed.
    #[error("failed to open JetStream object store: {0}")]
    #[diagnostic(code(canary_workers::object_store))]
    ObjectStore(String),

    /// Payload codec work failed.
    #[error(transparent)]
    #[diagnostic(transparent)]
    Codec(#[from] crate::codec::CodecError),
}
