//! # document-hierarchy
//!
//! Parse XML documents into hierarchical trees with stable anchor-based navigation.
//!
//! ## Quick Start
//!
//! ```no_run
//! use document_hierarchy::TreeParser;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let parser = TreeParser::new();
//! let tree = parser.parse_xml_file("document.xml")?;
//!
//! // Find section by anchor
//! if let Some(id) = tree.find_by_anchor("introduction") {
//!     println!("Found introduction at path: {}", tree.hierarchical_path(id));
//! }
//! # Ok(())
//! # }
//! ```
//!
//! ## Architecture
//!
//! - **Arena-based storage**: Uses `indextree` for cache-friendly tree layout
//! - **Stable anchors**: Every section gets a URL-safe slug for linking
//! - **Dual indexing**: Hierarchical paths ("1.2.3") and named anchors ("#intro")
//! - **Zero-copy IDs**: `NodeId` is a lightweight copyable handle

pub mod error;
pub mod parser;
pub mod resolve;
pub mod tree;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(indextree::NodeId);

impl NodeId {
    #[must_use]
    pub fn into_raw(self) -> indextree::NodeId {
        self.0
    }

    #[must_use]
    pub fn from_raw(raw: indextree::NodeId) -> Self {
        Self(raw)
    }
}

pub use error::{DocumentError, Result};
pub use parser::TreeParser;
pub use resolve::CrossRefResolver;
pub use tree::{
    ColumnAlign, ColumnAlignment, DocumentNode, DocumentTree, NodeKind, SectionEntry,
};

#[cfg(feature = "parallel")]
pub mod parallel;
