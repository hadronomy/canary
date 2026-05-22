use std::borrow::Cow;
use std::error::Error as StdError;
use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use thiserror::Error;
use tower::BoxError;

use crate::files::meta::BlobId;

pub type AppResult<T> = Result<T, AppError>;
type AnyError = Box<dyn StdError + Send + Sync + 'static>;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("configuration file specified by {key} does not exist: {path}")]
    MissingExplicitPath { key: &'static str, path: PathBuf },
    #[error("{message}")]
    Invalid {
        message: Cow<'static, str>,
        #[source]
        source: Option<AnyError>,
    },
    #[error("failed to serialize the default configuration layer")]
    SerializeDefaults {
        #[source]
        source: toml::ser::Error,
    },
    #[error("failed to build layered configuration")]
    Build {
        #[source]
        source: config::ConfigError,
    },
    #[error("failed to deserialize layered configuration")]
    Deserialize {
        #[source]
        source: config::ConfigError,
    },
}

impl ConfigError {
    #[must_use]
    pub fn invalid(message: impl Into<Cow<'static, str>>) -> Self {
        Self::Invalid { message: message.into(), source: None }
    }

    #[must_use]
    pub fn with_source<E>(mut self, source: E) -> Self
    where
        E: StdError + Send + Sync + 'static,
    {
        if let Self::Invalid { source: inner, .. } = &mut self {
            *inner = Some(Box::new(source));
        }
        self
    }
}

#[derive(Debug, Error)]
pub enum DbError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error("database mode is not compiled in: {message}")]
    UnsupportedMode { message: Cow<'static, str> },
    #[error("failed to connect to surrealdb")]
    Connect {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to authenticate against surrealdb")]
    Authenticate {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to select surrealdb namespace/database")]
    Select {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("surrealdb health check failed")]
    Health {
        #[source]
        source: Box<surrealdb::Error>,
    },
}

#[derive(Debug, Error)]
pub enum FileError {
    #[error("invalid blob id")]
    InvalidBlobId,
    #[error("blob {id} not found")]
    NotFound { id: BlobId },
    #[error("invalid file name")]
    InvalidFileName,
    #[error("invalid content type")]
    InvalidContentType,
    #[error("failed to create staging directory")]
    CreateDir {
        #[source]
        source: io::Error,
    },
    #[error("failed to read upload body")]
    ReadBody {
        #[source]
        source: AnyError,
    },
    #[error("failed to read multipart body")]
    Multipart {
        #[source]
        source: AnyError,
    },
    #[error("failed to open staged file")]
    Open {
        #[source]
        source: io::Error,
    },
    #[error("failed to write staged file")]
    Write {
        #[source]
        source: io::Error,
    },
    #[error("failed to persist staged file")]
    Persist {
        #[source]
        source: io::Error,
    },
    #[error("failed to read persisted file")]
    ReadFile {
        #[source]
        source: io::Error,
    },
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Config(Box<ConfigError>),
    #[error(transparent)]
    Database(Box<DbError>),
    #[error(transparent)]
    Files(Box<FileError>),
    #[error("failed to install observability subscriber")]
    Observability {
        #[source]
        source: AnyError,
    },
    #[error("failed to build tokio runtime")]
    RuntimeBuild {
        #[source]
        source: io::Error,
    },
    #[error("failed to bind HTTP listener on {address}")]
    Bind {
        address: SocketAddr,
        #[source]
        source: io::Error,
    },
    #[error("HTTP server terminated unexpectedly")]
    Serve {
        #[source]
        source: io::Error,
    },
    #[error("failed to install shutdown signal handler")]
    Signal {
        #[source]
        source: io::Error,
    },
    #[error("background task failed")]
    TaskJoin {
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("graceful shutdown exceeded {grace_period:?}")]
    GracefulShutdownTimeout { grace_period: Duration },
    #[error("request timed out")]
    RequestTimeout,
    #[error("{message}")]
    BadRequest { code: &'static str, message: Cow<'static, str> },
    #[error("{message}")]
    NotFound { code: &'static str, message: Cow<'static, str> },
    #[error("{message}")]
    ServiceUnavailable { code: &'static str, message: Cow<'static, str> },
    #[error("{message}")]
    Internal {
        code: &'static str,
        message: Cow<'static, str>,
        #[source]
        source: Option<AnyError>,
    },
}

impl From<ConfigError> for AppError {
    fn from(source: ConfigError) -> Self {
        Self::Config(Box::new(source))
    }
}

impl From<DbError> for AppError {
    fn from(source: DbError) -> Self {
        Self::Database(Box::new(source))
    }
}

impl From<FileError> for AppError {
    fn from(source: FileError) -> Self {
        Self::Files(Box::new(source))
    }
}

impl AppError {
    #[must_use]
    pub fn bad_request(message: impl Into<Cow<'static, str>>) -> Self {
        Self::BadRequest { code: "bad_request", message: message.into() }
    }

    #[must_use]
    pub fn not_found(message: impl Into<Cow<'static, str>>) -> Self {
        Self::NotFound { code: "not_found", message: message.into() }
    }

    #[must_use]
    pub fn service_unavailable(message: impl Into<Cow<'static, str>>) -> Self {
        Self::ServiceUnavailable { code: "service_unavailable", message: message.into() }
    }

    #[must_use]
    pub fn internal(code: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::Internal { code, message: message.into(), source: None }
    }

    #[must_use]
    pub fn with_source<E>(mut self, source: E) -> Self
    where
        E: StdError + Send + Sync + 'static,
    {
        if let Self::Internal { source: inner, .. } = &mut self {
            *inner = Some(Box::new(source));
        }
        self
    }

    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(..) => "configuration_error",
            Self::Database(..) => "database_error",
            Self::Files(..) => "file_error",
            Self::Observability { .. } => "observability_error",
            Self::RuntimeBuild { .. } => "runtime_build_error",
            Self::Bind { .. } => "bind_error",
            Self::Serve { .. } => "serve_error",
            Self::Signal { .. } => "signal_error",
            Self::TaskJoin { .. } => "task_join_error",
            Self::GracefulShutdownTimeout { .. } => "shutdown_timeout",
            Self::RequestTimeout => "request_timeout",
            Self::BadRequest { code, .. }
            | Self::NotFound { code, .. }
            | Self::ServiceUnavailable { code, .. }
            | Self::Internal { code, .. } => code,
        }
    }

    #[must_use]
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::BadRequest { .. } | Self::Config(..) => StatusCode::BAD_REQUEST,
            Self::Files(source) if matches!(source.as_ref(), FileError::InvalidBlobId) => {
                StatusCode::BAD_REQUEST
            }
            Self::NotFound { .. } => StatusCode::NOT_FOUND,
            Self::Files(source) if matches!(source.as_ref(), FileError::NotFound { .. }) => {
                StatusCode::NOT_FOUND
            }
            Self::ServiceUnavailable { .. } | Self::GracefulShutdownTimeout { .. } => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            Self::RequestTimeout => StatusCode::REQUEST_TIMEOUT,
            Self::Database(..)
            | Self::Observability { .. }
            | Self::RuntimeBuild { .. }
            | Self::Bind { .. }
            | Self::Serve { .. }
            | Self::Signal { .. }
            | Self::TaskJoin { .. }
            | Self::Files(..)
            | Self::Internal { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    #[must_use]
    pub fn from_box_error(error: BoxError) -> Self {
        if error.is::<tower::timeout::error::Elapsed>() {
            return Self::RequestTimeout;
        }
        Self::internal("middleware_error", "The request failed inside the HTTP middleware stack.")
            .with_boxed_source(error)
    }

    #[must_use]
    pub fn with_boxed_source(mut self, source: AnyError) -> Self {
        if let Self::Internal { source: inner, .. } = &mut self {
            *inner = Some(source);
        }
        self
    }
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if self.status_code().is_server_error() {
            tracing::error!(error = %self, code = self.code(), "request failed");
        } else {
            tracing::warn!(error = %self, code = self.code(), "request failed");
        }

        let status = self.status_code();
        let body = Json(ErrorEnvelope {
            error: ErrorBody { code: self.code(), message: self.to_string() },
        });
        (status, body).into_response()
    }
}
