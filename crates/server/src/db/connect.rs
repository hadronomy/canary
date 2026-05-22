use surrealdb::Surreal;
use surrealdb::engine::any::{Any, connect};
use surrealdb::opt::auth::{Database as DatabaseAuth, Namespace as NamespaceAuth, Root};

use crate::config::{EmbeddedSurrealConfig, SurrealAuth, SurrealConfig, SurrealMode};
use crate::error::DbError;

pub async fn connect_db(config: &SurrealConfig) -> Result<Surreal<Any>, DbError> {
    validate_surreal_mode(&config.mode)?;
    let db = connect(mode_endpoint(&config.mode))
        .await
        .map_err(|source| DbError::Connect { source: Box::new(source) })?;

    match &config.auth {
        SurrealAuth::None => {}
        SurrealAuth::Root { username, password } => {
            db.signin(Root { username: username.as_str(), password: password.reveal() })
                .await
                .map_err(|source| DbError::Authenticate { source: Box::new(source) })?;
        }
        SurrealAuth::Namespace { username, password } => {
            db.signin(NamespaceAuth {
                namespace: config.ns.as_str(),
                username: username.as_str(),
                password: password.reveal(),
            })
            .await
            .map_err(|source| DbError::Authenticate { source: Box::new(source) })?;
        }
        SurrealAuth::Database { username, password } => {
            db.signin(DatabaseAuth {
                namespace: config.ns.as_str(),
                database: config.db.as_str(),
                username: username.as_str(),
                password: password.reveal(),
            })
            .await
            .map_err(|source| DbError::Authenticate { source: Box::new(source) })?;
        }
    }

    db.use_ns(config.ns.as_str())
        .use_db(config.db.as_str())
        .await
        .map_err(|source| DbError::Select { source: Box::new(source) })?;

    Ok(db)
}

pub fn validate_surreal_mode(mode: &SurrealMode) -> Result<(), DbError> {
    match mode {
        SurrealMode::Remote(_) if cfg!(feature = "surreal-remote-ws") || cfg!(feature = "surreal-remote-http") => Ok(()),
        SurrealMode::Embedded(EmbeddedSurrealConfig::Memory) if cfg!(feature = "surreal-embedded-mem") => Ok(()),
        SurrealMode::Embedded(EmbeddedSurrealConfig::RocksDb { .. }) if cfg!(feature = "surreal-embedded-rocksdb") => Ok(()),
        SurrealMode::Embedded(EmbeddedSurrealConfig::SurrealKv { .. }) if cfg!(feature = "surreal-embedded-surrealkv") => Ok(()),
        SurrealMode::Remote(_) => Err(DbError::UnsupportedMode {
            message: "remote surrealdb requested but no remote protocol feature is enabled".into(),
        }),
        SurrealMode::Embedded(EmbeddedSurrealConfig::Memory) => Err(DbError::UnsupportedMode {
            message: "embedded memory surrealdb requested but `surreal-embedded-mem` is disabled".into(),
        }),
        SurrealMode::Embedded(EmbeddedSurrealConfig::RocksDb { .. }) => Err(DbError::UnsupportedMode {
            message: "embedded rocksdb surrealdb requested but `surreal-embedded-rocksdb` is disabled".into(),
        }),
        SurrealMode::Embedded(EmbeddedSurrealConfig::SurrealKv { .. }) => Err(DbError::UnsupportedMode {
            message: "embedded surrealkv surrealdb requested but `surreal-embedded-surrealkv` is disabled".into(),
        }),
    }
}

fn mode_endpoint(mode: &SurrealMode) -> String {
    match mode {
        SurrealMode::Remote(cfg) => cfg.endpoint.as_str().to_owned(),
        SurrealMode::Embedded(EmbeddedSurrealConfig::Memory) => "memory".into(),
        SurrealMode::Embedded(EmbeddedSurrealConfig::RocksDb { path }) => {
            format!("rocksdb://{}", path.as_path().display())
        }
        SurrealMode::Embedded(EmbeddedSurrealConfig::SurrealKv { path }) => {
            format!("surrealkv://{}", path.as_path().display())
        }
    }
}
