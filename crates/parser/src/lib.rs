//! # pdf-hierarchy
//!
//! Parse XML documents into hierarchical trees with stable anchor-based navigation.
//!
//! ## Quick Start
//!
//! ```no_run
//! use pdf_hierarchy::TreeParser;
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
//! - **Zero-copy**: NodeIds are Copy types (usize indices)

pub mod error;
pub mod parser;
pub mod resolve;
pub mod tree;

pub use error::{DocumentError, Result};
pub use indextree::NodeId;
pub use parser::TreeParser;
pub use resolve::CrossRefResolver;
pub use tree::{
    ColumnAlign, ColumnAlignment, DocumentNode, DocumentTree, NodeKind, NodeMeta, SectionEntry,
};

#[cfg(feature = "parallel")]
pub mod parallel;
