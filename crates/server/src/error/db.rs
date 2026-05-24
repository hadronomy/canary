use std::borrow::Cow;

use miette::Diagnostic;
use thiserror::Error;

use super::ConfigError;

#[derive(Debug, Error, Diagnostic)]
pub enum DbError {
    #[error(transparent)]
    #[diagnostic(transparent)]
    Config(#[from] ConfigError),
    #[error("database mode is not compiled in: {message}")]
    #[diagnostic(
        code(canary_server::db::unsupported_mode),
        help("Enable the matching SurrealDB cargo feature for the configured database mode.")
    )]
    UnsupportedMode { message: Cow<'static, str> },
    #[error("failed to connect to surrealdb")]
    #[diagnostic(code(canary_server::db::connect))]
    Connect {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to authenticate against surrealdb")]
    #[diagnostic(code(canary_server::db::authenticate))]
    Authenticate {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("failed to select surrealdb namespace/database")]
    #[diagnostic(code(canary_server::db::select))]
    Select {
        #[source]
        source: Box<surrealdb::Error>,
    },
    #[error("surrealdb health check failed")]
    #[diagnostic(code(canary_server::db::health))]
    Health {
        #[source]
        source: Box<surrealdb::Error>,
    },
}
