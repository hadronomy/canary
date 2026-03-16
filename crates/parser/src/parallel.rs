//! Parallel iteration support (requires "parallel" feature)

use rayon::prelude::*;

use crate::NodeId;
use crate::tree::{DocumentTree, NodeKind, SectionEntry};

/// Parallel operations for DocumentTree
pub trait ParallelTreeOps {
    /// Extract sections in parallel
    fn par_sections(&self) -> Vec<SectionEntry>;

    /// Parallel text extraction (aggregate)
    fn par_extract_all_text(&self) -> Vec<(NodeId, String)>;
}

impl ParallelTreeOps for DocumentTree {
    fn par_sections(&self) -> Vec<SectionEntry> {
        let nodes: Vec<NodeId> = self.descendants(self.root()).collect();

        nodes
            .into_par_iter()
            .filter_map(|id| {
                let node = self.get(id)?;
                if !matches!(&node.kind, NodeKind::Section { .. }) {
                    None
                } else {
                    Some(SectionEntry {
                        id,
                        anchor: node.anchor.clone().unwrap_or_default(),
                        path: self.hierarchical_path(id),
                        level: node.section_level().unwrap_or(0),
                    })
                }
            })
            .collect()
    }

    fn par_extract_all_text(&self) -> Vec<(NodeId, String)> {
        let nodes: Vec<NodeId> = self.descendants(self.root()).collect();

        nodes
            .into_par_iter()
            .filter_map(|id| {
                let text = self.extract_text(id);
                if text.is_empty() { None } else { Some((id, text)) }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DocumentNode;

    #[test]
    #[cfg(feature = "parallel")]
    fn test_par_sections() {
        let mut tree = DocumentTree::new();
        for i in 1..=100 {
            tree.add_child(tree.root(), DocumentNode::section(1, format!("Section {i}")));
        }

        let sections = tree.par_sections();
        assert_eq!(sections.len(), 100);
    }
}
