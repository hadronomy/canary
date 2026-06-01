#![forbid(unsafe_code)]

//! **Database runtime support for Canary.**
//!
//! This crate owns the SurrealDB integration layer for the workspace: validated
//! configuration, connection setup, authentication, a cheap shared runtime
//! handle, and an explicit session escape hatch when isolated client state is
//! actually needed.
//!
//! It intentionally does *not* try to replace the SurrealDB SDK. Instead, it
//! draws a cleaner boundary around it:
//!
//! - [`Config`] describes *how* the application should connect.
//! - [`Database`] is the shared runtime handle that the rest of the app clones.
//! - [`Session`] is the explicit "I really want an isolated SDK session" tool.
//! - Surreal's own fluent operations still flow through methods like
//!   [`Database::query`], [`Database::select`], and [`Database::upsert`].
//!
//! That split keeps feature code out of connection and authentication plumbing
//! while avoiding a second, worse query DSL on top of SurrealDB.
//!
//! [^session]: SurrealDB's session model is meaningful. Treat "share the app
//!     handle" and "start a distinct database session" as separate actions.
//!
//! # A small example
//!
//! ```no_run
//! # use database::{Config, Database};
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! let cfg = Config::default();
//! let db = Database::connect(&cfg).await?;
//!
//! db.health().await?;
//!
//! let people: Vec<surrealdb::Value> = db.select("person").await?;
//! let _ = people;
//! # Ok(())
//! # }
//! ```
//!
//! # Surrealkit and schema workflow
//!
//! This crate is the *runtime* side of the database story. Schema sync,
//! rollouts, seed data, and declarative database tests belong to
//! *Surrealkit*, not here. In practice that means:
//!
//! - use this crate to connect, query, and run the application
//! - use Surrealkit to manage `crates/database/database/schema`,
//!   `crates/database/database/rollouts`, `crates/database/database/seed`, and
//!   database-focused test suites
//!
//! Keeping those roles separate makes both tools easier to reason about.

mod config;
mod connect;
mod error;
mod handle;
mod raw;

pub use config::{Auth, Config, DataDir, DatabaseName, Endpoint, Engine, Namespace};
pub use error::{ConfigError, Error, Result};
pub use handle::{Database, Session};
