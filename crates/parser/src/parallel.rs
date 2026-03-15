//! Parallel iteration support (requires "parallel" feature)

use indextree::NodeId;
use rayon::prelude::*;

use crate::tree::{DocumentNode, DocumentTree, NodeKind};

/// Parallel operations for DocumentTree
pub trait ParallelTreeOps {
    /// Extract sections in parallel
    fn par_sections(&self) -> Vec<(NodeId, String, String, u8)>;

    /// Parallel text extraction (aggregate)
    fn par_extract_all_text(&self) -> Vec<(NodeId, String)>;
}

impl ParallelTreeOps for DocumentTree {
    fn par_sections(&self) -> Vec<(NodeId, String, String, u8)> {
        let nodes: Vec<NodeId> = self.descendants(self.root()).collect();

        nodes
            .into_par_iter()
            .filter_map(|id| {
                let node = self.get(id)?;
                if let NodeKind::Section { level, .. } = &node.kind {
                    let path = self.hierarchical_path(id);
                    let anchor = node.anchor.clone().unwrap_or_default();
                    Some((id, anchor, path, *level))
                } else {
                    None
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
    use crate::TreeParser;

    #[test]
    #[cfg(feature = "parallel")]
    fn test_par_sections() {
        let parser = TreeParser::new();
        let md =
            (1..=100).map(|i| format!("# Section {}\n\nText", i)).collect::<Vec<_>>().join("\n");
        let tree = parser.parse_markdown(&md).unwrap();

        let sections = tree.par_sections();
        assert_eq!(sections.len(), 100);
    }
}
