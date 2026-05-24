use std::net::SocketAddr;
use std::time::Duration;
use std::{io, result};

use miette::Diagnostic;
use thiserror::Error;

use super::{ConfigError, DbError, FileError, SourceError};

pub type ServerResult<T> = result::Result<T, ServerError>;

#[derive(Debug, Error, Diagnostic)]
pub enum ServerError {
    #[error(transparent)]
    #[diagnostic(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    #[diagnostic(transparent)]
    Database(#[from] DbError),
    #[error(transparent)]
    #[diagnostic(transparent)]
    Files(#[from] FileError),
    #[error("failed to install observability subscriber")]
    #[diagnostic(
        code(canary_server::server::observability),
        help("Check the configured log filter and output settings.")
    )]
    Observability {
        #[source]
        source: SourceError,
    },
    #[error("failed to build tokio runtime")]
    #[diagnostic(code(canary_server::server::runtime_build))]
    RuntimeBuild {
        #[source]
        source: io::Error,
    },
    #[error("failed to bind HTTP listener on {address}")]
    #[diagnostic(code(canary_server::server::bind))]
    Bind {
        address: SocketAddr,
        #[source]
        source: io::Error,
    },
    #[error("failed to inspect bound HTTP listener")]
    #[diagnostic(code(canary_server::server::listener_introspection))]
    ListenerIntrospection {
        #[source]
        source: io::Error,
    },
    #[error("HTTP server terminated unexpectedly")]
    #[diagnostic(code(canary_server::server::serve))]
    Serve {
        #[source]
        source: io::Error,
    },
    #[error("failed to install shutdown signal handler")]
    #[diagnostic(code(canary_server::server::signal))]
    Signal {
        #[source]
        source: io::Error,
    },
    #[error("background task failed")]
    #[diagnostic(code(canary_server::server::task_join))]
    TaskJoin {
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("graceful shutdown exceeded {grace_period:?}")]
    #[diagnostic(code(canary_server::server::shutdown_timeout))]
    GracefulShutdownTimeout { grace_period: Duration },
}
