use std::path::PathBuf;

use secrecy::SecretString;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub(crate) struct ConfigDef {
    #[serde(alias = "ns")]
    pub(crate) namespace: String,
    #[serde(alias = "db")]
    pub(crate) database: String,
    pub(crate) auth: AuthDef,
    #[serde(alias = "mode")]
    pub(crate) engine: EngineDef,
}

impl Default for ConfigDef {
    fn default() -> Self {
        Self {
            namespace: "main".into(),
            database: "main".into(),
            auth: AuthDef::None,
            engine: EngineDef::Memory,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum AuthDef {
    #[default]
    None,
    Root {
        username: String,
        password: SecretString,
    },
    Namespace {
        username: String,
        password: SecretString,
    },
    Database {
        username: String,
        password: SecretString,
    },
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum EngineDef {
    Remote {
        endpoint: String,
    },
    #[default]
    Memory,
    Rocksdb {
        path: PathBuf,
    },
    Surrealkv {
        path: PathBuf,
    },
}
