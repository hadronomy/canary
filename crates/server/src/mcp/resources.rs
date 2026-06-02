//! Stable `canary://` resource templates exposed through MCP.
//!
//! Tools return resource links when an agent needs more context than a compact
//! structured result should carry. These templates reserve the public URI
//! vocabulary before storage-backed reads are implemented.

use rmcp::model::{
    AnnotateAble, ListResourceTemplatesResult, ListResourcesResult, RawResourceTemplate,
    ReadResourceResult,
};

use crate::mcp::error;

/// Collection summary and navigation metadata.
pub const COLLECTION: &str = "canary://collections/{collection_id}";

/// Canonical normalized document content and metadata.
pub const DOCUMENT: &str = "canary://collections/{collection_id}/documents/{document_id}";

/// Focused evidence chunk returned by retrieval.
pub const CHUNK: &str = "canary://collections/{collection_id}/chunks/{chunk_id}";

/// Current state of one ingestion.
pub const INGESTION: &str = "canary://collections/{collection_id}/ingestions/{ingestion_id}";

/// Diagnostic event stream recorded for one ingestion.
pub const INGESTION_EVENTS: &str =
    "canary://collections/{collection_id}/ingestions/{ingestion_id}/events";

/// Connector source configuration visible to the current principal.
pub const SOURCE: &str = "canary://collections/{collection_id}/sources/{source_id}";

/// Current state of one connector synchronization run.
pub const SOURCE_RUN: &str =
    "canary://collections/{collection_id}/sources/{source_id}/runs/{run_id}";

/// Lists concrete top-level resources available before a caller follows a tool result.
///
/// No concrete resources are exposed until the collection service exists.
/// Resource templates remain available through [`templates`].
#[must_use]
#[inline(always)]
pub(crate) fn list() -> ListResourcesResult {
    ListResourcesResult::default()
}

/// Lists the parameterized resource templates that tools may return as links.
#[must_use]
pub(crate) fn templates() -> ListResourceTemplatesResult {
    ListResourceTemplatesResult {
        resource_templates: vec![
            template(COLLECTION, "collection", "Collection summary and navigation metadata"),
            template(DOCUMENT, "document", "Canonical normalized document content and metadata"),
            template(CHUNK, "chunk", "Focused evidence chunk returned by retrieval"),
            template(INGESTION, "ingestion", "Current ingestion state and progress"),
            template(INGESTION_EVENTS, "ingestion-events", "Diagnostic ingestion events"),
            template(SOURCE, "source", "Connector source metadata visible to the caller"),
            template(SOURCE_RUN, "source-run", "Connector synchronization state and results"),
        ],
        next_cursor: None,
        meta: None,
    }
}

/// Reads a resource after URI parsing, authorization, and domain services are available.
///
/// # Errors
///
/// Returns a structured `not_implemented` MCP resource error until the
/// corresponding domain services exist.
pub(crate) fn read(uri: &str) -> Result<ReadResourceResult, rmcp::ErrorData> {
    Err(error::resource(uri))
}

#[inline(always)]
fn template(uri: &str, name: &str, description: &str) -> rmcp::model::ResourceTemplate {
    RawResourceTemplate::new(uri, name)
        .with_description(description)
        .with_mime_type("application/json")
        .no_annotation()
}
