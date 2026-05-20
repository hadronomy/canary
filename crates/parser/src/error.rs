//! Error types for document parsing and navigation

use indextree::NodeError;
use quick_xml::Error as QuickXmlError;
use thiserror::Error;

use crate::NodeId;
use crate::tree::NodeKind;

/// Result type alias for this crate
pub type Result<T> = std::result::Result<T, DocumentError>;

impl DocumentError {
    pub fn xml(msg: impl Into<String>) -> Self {
        Self::Xml { message: msg.into(), offset: None }
    }

    pub fn xml_at(offset: usize, msg: impl Into<String>) -> Self {
        Self::Xml { message: msg.into(), offset: Some(offset) }
    }
}

/// Errors that can occur during document processing
#[derive(Error, Debug)]
pub enum DocumentError {
    #[error("XML parsing failed: {message}")]
    Xml { message: String, offset: Option<usize> },

    /// Missing required XML element
    #[error("Missing required XML element: {path}")]
    MissingElement { path: &'static str },

    /// Anchor not found in document
    #[error("Anchor not found: {0}")]
    AnchorNotFound(String),

    /// Node not found in tree
    #[error("Node not found in tree")]
    NodeNotFound,

    /// Tree mutation failure
    #[error(transparent)]
    TreeMutation(#[from] TreeMutationError),

    /// Anchor validation failure
    #[error(transparent)]
    Anchor(#[from] AnchorError),

    /// Tree build failure
    #[error(transparent)]
    TreeBuild(#[from] TreeBuildError),

    /// Tree lookup failure
    #[error(transparent)]
    NodeLookup(#[from] NodeLookupError),

    /// Invalid path format
    #[error("Invalid section path `{path}`: {reason}")]
    InvalidPath { path: String, reason: String },

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// quick-xml parse error
    #[error("XML decode error: {0}")]
    QuickXml(#[from] QuickXmlError),
}

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum AnchorError {
    #[error("node of kind {kind:?} cannot carry an anchor")]
    NotAnchorable { kind: NodeKind },

    #[error("section anchors cannot be removed")]
    RequiredAnchor,
}

#[derive(Error, Debug)]
pub enum TreeMutationError {
    #[error("node {id:?} does not exist in this tree")]
    UnknownNode { id: NodeId },

    #[error("parent node {parent:?} does not exist in this tree")]
    UnknownParent { parent: NodeId },

    #[error("node {id:?} of kind {kind:?} cannot carry an anchor")]
    NotAnchorable { id: NodeId, kind: NodeKind },

    #[error("section node {id:?} must keep an anchor")]
    RequiredAnchor { id: NodeId },

    #[error("failed to attach child {child:?} under parent {parent:?}: {source}")]
    Structural {
        parent: NodeId,
        child: NodeId,
        #[source]
        source: NodeError,
    },
}

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum TreeBuildError {
    #[error(
        "section parent {parent:?} has too many child sections: sibling index {index} exceeds u16"
    )]
    TooManySectionSiblings { parent: NodeId, index: usize },
}

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum NodeLookupError {
    #[error("node {id:?} does not exist in this tree")]
    UnknownNode { id: NodeId },
}
