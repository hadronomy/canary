//! Error types for document parsing and navigation

use thiserror::Error;

/// Result type alias for this crate
pub type Result<T> = std::result::Result<T, DocumentError>;

/// Errors that can occur during document processing
#[derive(Error, Debug, Clone, PartialEq)]
pub enum DocumentError {
    /// PDF extraction failed
    #[error("PDF extraction failed: {0}")]
    Pdf(String),

    /// Markdown parsing failed
    #[error("Markdown parsing failed: {0}")]
    Markdown(String),

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

impl From<pdf_oxide::Error> for DocumentError {
    fn from(e: pdf_oxide::Error) -> Self {
        DocumentError::Pdf(e.to_string())
    }
}
