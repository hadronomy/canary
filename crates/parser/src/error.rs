//! Error types for document parsing and navigation

use thiserror::Error;

/// Result type alias for this crate
pub type Result<T> = std::result::Result<T, DocumentError>;

impl DocumentError {
    pub fn xml(msg: impl Into<String>) -> Self {
        Self::Xml(msg.into())
    }
}

/// Errors that can occur during document processing
#[derive(Error, Debug, Clone, PartialEq)]
pub enum DocumentError {
    #[error("XML parsing failed: {0}")]
    Xml(String),

    /// Anchor not found in document
    #[error("Anchor not found: {0}")]
    AnchorNotFound(String),

    /// Node not found in tree
    #[error("Node not found in tree")]
    NodeNotFound,

    /// Invalid path format
    #[error("Invalid hierarchical path: {0}")]
    InvalidPath(String),

    /// IO error
    #[error("IO error: {0}")]
    Io(String),
}

impl From<std::io::Error> for DocumentError {
    fn from(e: std::io::Error) -> Self {
        DocumentError::Io(e.to_string())
    }
}
