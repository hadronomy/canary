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
//! - **Dual indexing**: Typed section paths and named anchors
//! - **Zero-copy IDs**: `NodeId` is a lightweight copyable handle

pub mod error;
pub mod parser;
pub mod render;
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

pub use error::{
    AnchorError, DocumentError, NodeLookupError, Result, TreeBuildError, TreeMutationError,
};
pub use parser::{TreeParser, VersionPolicy};
pub use render::markdown::{HeadingMode, MarkdownWriter};
pub use render::writer::{RenderEvent, TreeWriter};
pub use resolve::{Breadcrumb, CrossRefResolver, ReferenceQuery};
pub use tree::{
    Anchor, Atom, BlockId, ColumnAlign, ColumnAlignment, DocumentNode, DocumentTree,
    DocumentTreeBuilder, ExternalLink, HeadingLevel, Language, LinkTarget, ListSpacing, ListStyle,
    NodeKind, NodeRef, NodeView, ReferenceId, SectionEntry, SectionIndex, SectionKind, SectionPath,
    SeparatorPolicy, Tag, TagEnd, TextExtractOptions, TextSpan, TextSpanKind, Visit, VisitFlow,
    visit_children,
};

#[cfg(feature = "parallel")]
pub mod parallel;
