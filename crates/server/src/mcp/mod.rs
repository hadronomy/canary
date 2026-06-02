//! Curated Model Context Protocol surface for agents and agent runtimes.
//!
//! This module deliberately exposes a smaller surface than the REST API. MCP
//! tools are named for agent comprehension, return compact structured results,
//! and link to resources when a caller needs deeper context.
//!
//! The first implementation establishes the protocol boundary before the
//! collection, retrieval, ingestion, and connector services exist. Tools that
//! depend on those services are discoverable now and return a structured
//! `not_implemented` error when invoked. Prompt-backed skills and resource
//! templates are already usable because they do not require domain storage.
//!
//! # Capabilities
//!
//! | Capability | Initial behavior |
//! | --- | --- |
//! | Tools | Curated catalog with typed schemas and structured stub errors |
//! | Resources | Stable `canary://` templates with deferred reads |
//! | Prompts | User-selectable workflows for grounded agent behavior |
//! | Tasks | Deferred until Canary operations can provide durable backing |
//!
//! HTTP transport wiring lives in [`crate::http::routes::mcp`]. The MCP
//! endpoint is mounted separately from REST so long-lived SSE streams do not
//! inherit ordinary request timeouts.

pub mod error;
pub mod model;
pub mod prompts;
pub mod resources;
pub mod server;
pub mod tools;
pub mod transport;

pub use server::Mcp;
