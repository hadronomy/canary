use secrecy::ExposeSecret;
use surrealdb::Surreal;
use surrealdb::engine::any::{Any, connect};
use surrealdb::opt::auth::{Database as DatabaseAuth, Namespace as NamespaceAuth, Root};

use crate::config::{Auth, Config, DataDir, Engine};
use crate::error::{Error, Result};

pub async fn connect_db(cfg: &Config) -> Result<Surreal<Any>> {
    validate_engine(cfg.engine())?;
    let db = connect(engine_endpoint(cfg.engine()))
        .await
        .map_err(|source| Error::Connect { source: Box::new(source) })?;

    match cfg.auth() {
        Auth::None => {}
        Auth::Root { username, password } => {
            db.signin(Root { username: username.as_str(), password: password.expose_secret() })
                .await
                .map_err(|source| Error::Authenticate { source: Box::new(source) })?;
        }
        Auth::Namespace { username, password } => {
            db.signin(NamespaceAuth {
                namespace: cfg.namespace().as_str(),
                username: username.as_str(),
                password: password.expose_secret(),
            })
            .await
            .map_err(|source| Error::Authenticate { source: Box::new(source) })?;
        }
        Auth::Database { username, password } => {
            db.signin(DatabaseAuth {
                namespace: cfg.namespace().as_str(),
                database: cfg.database().as_str(),
                username: username.as_str(),
                password: password.expose_secret(),
            })
            .await
            .map_err(|source| Error::Authenticate { source: Box::new(source) })?;
        }
    }

    db.use_ns(cfg.namespace().as_str())
        .use_db(cfg.database().as_str())
        .await
        .map_err(|source| Error::SelectContext { source: Box::new(source) })?;

    Ok(db)
}

pub fn validate_engine(engine: &Engine) -> Result<()> {
    match engine {
        Engine::Remote { .. } if cfg!(feature = "remote-ws") || cfg!(feature = "remote-http") => {
            Ok(())
        }
        Engine::Memory if cfg!(feature = "embedded-mem") => Ok(()),
        Engine::RocksDb { .. } if cfg!(feature = "embedded-rocksdb") => Ok(()),
        Engine::SurrealKv { .. } if cfg!(feature = "embedded-surrealkv") => Ok(()),
        Engine::Remote { .. } => Err(Error::UnsupportedEngine {
            message: "remote surrealdb requested but no remote protocol feature is enabled".into(),
        }),
        Engine::Memory => Err(Error::UnsupportedEngine {
            message: "embedded memory surrealdb requested but `embedded-mem` is disabled".into(),
        }),
        Engine::RocksDb { .. } => Err(Error::UnsupportedEngine {
            message: "embedded rocksdb surrealdb requested but `embedded-rocksdb` is disabled"
                .into(),
        }),
        Engine::SurrealKv { .. } => Err(Error::UnsupportedEngine {
            message: "embedded surrealkv surrealdb requested but `embedded-surrealkv` is disabled"
                .into(),
        }),
    }
}

fn engine_endpoint(engine: &Engine) -> String {
    match engine {
        Engine::Remote { endpoint } => endpoint.as_str().to_owned(),
        Engine::Memory => "memory".into(),
        Engine::RocksDb { dir } => embedded_endpoint("rocksdb", dir),
        Engine::SurrealKv { dir } => embedded_endpoint("surrealkv", dir),
    }
}

fn embedded_endpoint(kind: &str, dir: &DataDir) -> String {
    format!("{kind}://{}", dir.as_path().display())
}
