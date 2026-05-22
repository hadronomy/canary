use surrealdb::Surreal;
use surrealdb::engine::any::Any;

use crate::config::SurrealConfig;
use crate::db::connect::connect_db;
use crate::error::DbError;

#[derive(Clone)]
pub struct DatabaseService {
    db: Surreal<Any>,
}

impl DatabaseService {
    pub async fn connect(config: &SurrealConfig) -> Result<Self, DbError> {
        let db = connect_db(config).await?;
        Ok(Self { db })
    }

    pub async fn health(&self) -> Result<(), DbError> {
        self.db.health().await.map_err(|source| DbError::Health { source: Box::new(source) })
    }

    #[must_use]
    pub fn client(&self) -> &Surreal<Any> {
        &self.db
    }
}
