use std::sync::Arc;

use surrealdb::Surreal;
use surrealdb::engine::any::Any;
use surrealdb::method::{Delete, Query, Select, Upsert, UseDb, UseNs, Version};
use surrealdb::opt::{IntoQuery, IntoResource};

use crate::config::{Config, DatabaseName, Namespace};
use crate::connect::connect_db;
use crate::error::{Error, Result};

/// Shared runtime handle for database work.
///
/// Cloning this type is cheap and intentional. It clones an internal [`Arc`]
/// around the connected client and its immutable configuration, which makes it
/// the right handle to keep in application state.
#[derive(Clone)]
pub struct Database {
    inner: Arc<Inner>,
}

struct Inner {
    cfg: Config,
    db: Surreal<Any>,
}

/// Explicit isolated SDK session.
///
/// Use this when you genuinely want separate session state on the SurrealDB
/// side, such as a different namespace/database selection or different
/// session-scoped variables.
#[derive(Clone)]
pub struct Session {
    db: Surreal<Any>,
}

impl Database {
    /// Connects to SurrealDB using the provided configuration.
    ///
    /// # Errors
    ///
    /// Returns an error if the configured engine is not compiled in, if the
    /// underlying client cannot connect, or if authentication/context
    /// selection fails.
    pub async fn connect(cfg: &Config) -> Result<Self> {
        let db = connect_db(cfg).await?;
        Ok(Self { inner: Arc::new(Inner { cfg: cfg.clone(), db }) })
    }

    /// Returns the validated configuration this handle was created with.
    #[must_use]
    pub fn config(&self) -> &Config {
        &self.inner.cfg
    }

    /// Returns the configured namespace.
    #[must_use]
    pub fn namespace(&self) -> &Namespace {
        self.inner.cfg.namespace()
    }

    /// Returns the configured database name.
    #[must_use]
    pub fn database(&self) -> &DatabaseName {
        self.inner.cfg.database()
    }

    /// Creates an explicit isolated SDK session.
    ///
    /// For ordinary application work, clone [`Database`] instead and keep using
    /// the shared handle.
    #[must_use]
    pub fn session(&self) -> Session {
        Session { db: self.inner.db.clone() }
    }

    /// Checks that the current connection is healthy.
    ///
    /// # Errors
    ///
    /// Returns an error if the health request fails.
    pub async fn health(&self) -> Result<()> {
        self.inner.db.health().await.map_err(|source| Error::Health { source: Box::new(source) })
    }

    /// Starts a SurrealQL query operation on the shared handle.
    pub fn query(&self, sql: impl IntoQuery) -> Query<'_, Any> {
        self.inner.db.query(sql)
    }

    /// Starts a typed select operation on the shared handle.
    pub fn select<O>(&self, thing: impl IntoResource<O>) -> Select<'_, Any, O> {
        self.inner.db.select(thing)
    }

    /// Starts a typed upsert operation on the shared handle.
    pub fn upsert<O>(&self, thing: impl IntoResource<O>) -> Upsert<'_, Any, O> {
        self.inner.db.upsert(thing)
    }

    /// Starts a typed delete operation on the shared handle.
    pub fn delete<O>(&self, thing: impl IntoResource<O>) -> Delete<'_, Any, O> {
        self.inner.db.delete(thing)
    }

    /// Starts a version request on the shared handle.
    pub fn version(&self) -> Version<'_, Any> {
        self.inner.db.version()
    }
}

impl Session {
    /// Selects the namespace to use for this session.
    pub fn use_namespace(&self, ns: impl Into<String>) -> UseNs<'_, Any> {
        self.db.use_ns(ns)
    }

    /// Selects the database to use for this session.
    pub fn use_database(&self, db: impl Into<String>) -> UseDb<'_, Any> {
        self.db.use_db(db)
    }

    /// Checks that this session can still reach the database.
    pub async fn health(&self) -> Result<()> {
        self.db.health().await.map_err(|source| Error::Health { source: Box::new(source) })
    }

    /// Starts a SurrealQL query operation on this session.
    pub fn query(&self, sql: impl IntoQuery) -> Query<'_, Any> {
        self.db.query(sql)
    }

    /// Starts a typed select operation on this session.
    pub fn select<O>(&self, thing: impl IntoResource<O>) -> Select<'_, Any, O> {
        self.db.select(thing)
    }

    /// Starts a typed upsert operation on this session.
    pub fn upsert<O>(&self, thing: impl IntoResource<O>) -> Upsert<'_, Any, O> {
        self.db.upsert(thing)
    }

    /// Starts a typed delete operation on this session.
    pub fn delete<O>(&self, thing: impl IntoResource<O>) -> Delete<'_, Any, O> {
        self.db.delete(thing)
    }

    /// Starts a version request on this session.
    pub fn version(&self) -> Version<'_, Any> {
        self.db.version()
    }
}
