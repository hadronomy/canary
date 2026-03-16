//! Error types for document parsing and navigation

use quick_xml::Error as QuickXmlError;
use thiserror::Error;

/// Result type alias for this crate
pub type Result<T> = std::result::Result<T, DocumentError>;

impl DocumentError {
    pub fn xml(msg: impl Into<String>) -> Self {
        Self::Xml { message: msg.into(), offset: 0 }
    }

    pub fn xml_at(offset: usize, msg: impl Into<String>) -> Self {
        Self::Xml { message: msg.into(), offset }
    }
}

/// Errors that can occur during document processing
#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("XML parsing failed at byte {offset}: {message}")]
    Xml { message: String, offset: usize },

    /// Missing required XML element
    #[error("Missing required XML element: {path}")]
    MissingElement { path: &'static str },

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
    Io(#[from] std::io::Error),

    /// quick-xml parse error
    #[error("XML decode error: {0}")]
    QuickXml(#[from] QuickXmlError),
}
