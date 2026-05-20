//! Core tree data structures and navigation.

mod build;
mod document;
mod node_ref;
mod path;
mod schema;
mod text;
mod value;
mod visit;

#[cfg(test)]
mod tests;

pub use build::DocumentTreeBuilder;
pub use document::DocumentTree;
pub use node_ref::{AncestorsIter, ChildrenIter, DescendantsIter, NodeRef};
pub use path::{SectionEntry, SectionPath};
pub use schema::{Atom, DocumentNode, NodeKind, NodeView, Tag, TagEnd, Visit};
use smallvec::SmallVec;
pub use text::{SeparatorPolicy, TextExtractOptions, TextSpan, TextSpanKind, TextSpans};
pub use value::{
    Anchor, BlockId, ColumnAlign, ColumnAlignment, ExternalLink, HeadingLevel, Language,
    LinkTarget, ListSpacing, ListStyle, ReferenceId, SectionIndex, SectionKind,
};
pub use visit::{VisitFlow, visit_children};

use crate::NodeId;

pub(super) type NodeSet = SmallVec<[NodeId; 1]>;
