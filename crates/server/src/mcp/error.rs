//! MCP-specific errors returned across the JSON-RPC boundary.
//!
//! REST handlers translate domain failures into RFC-compliant HTTP problem
//! responses. MCP handlers need a separate translator because JSON-RPC errors
//! have their own wire shape and clients use the structured `data` member when
//! deciding whether an operation can be retried.

use rmcp::ErrorData;
use serde_json::json;

/// Creates the structured error returned by an advertised but unfinished MCP operation.
///
/// An advertised stub uses an internal JSON-RPC error rather than pretending
/// the method is absent. The `data.code` field stays stable so agent runtimes
/// can report the unfinished capability clearly.
#[must_use]
pub fn todo(operation: &'static str) -> ErrorData {
    ErrorData::internal_error(
        "This MCP operation has not been implemented yet.",
        Some(json!({
            "code": "not_implemented",
            "operation": operation,
        })),
    )
}

/// Creates the structured error returned when a resource URI has no backing service yet.
///
/// Resource templates are available before storage-backed reads. Returning a
/// resource-specific error keeps the protocol scaffold discoverable without
/// implying that any resource content exists.
#[must_use]
pub fn resource(uri: &str) -> ErrorData {
    ErrorData::resource_not_found(
        "This MCP resource is not available yet.",
        Some(json!({
            "code": "not_implemented",
            "uri": uri,
        })),
    )
}
