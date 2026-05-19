//! Parallel iteration support (requires the `parallel` feature).

use rayon::prelude::*;

use crate::NodeId;
use crate::tree::DocumentTree;

impl DocumentTree {
    /// Extract sections in parallel.
    pub fn par_sections(&self) -> Vec<crate::tree::SectionEntry> {
        let ids = self.descendants(self.root()).map(|node| node.id()).collect::<Vec<_>>();
        ids.into_par_iter()
            .filter_map(|id| {
                let node = self.node(id)?;
                let (Some(anchor), Some(level)) =
                    (node.data().anchor_value(), node.section_level())
                else {
                    return None;
                };
                Some(crate::tree::SectionEntry {
                    id,
                    anchor: anchor.clone(),
                    path: node.path(),
                    level,
                })
            })
            .collect()
    }

    /// Extract visible text for every non-empty subtree in parallel.
    pub fn par_extract_all_text(&self) -> Vec<(NodeId, String)> {
        let ids = self.descendants(self.root()).map(|node| node.id()).collect::<Vec<_>>();
        ids.into_par_iter()
            .filter_map(|id| {
                let text = self.extract_text(id);
                if text.is_empty() { None } else { Some((id, text)) }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{DocumentNode, DocumentTree};

    #[test]
    #[cfg(feature = "parallel")]
    fn par_sections() {
        let mut tree = DocumentTree::builder();
        for i in 1..=100 {
            tree.add_child(tree.root(), DocumentNode::section(1, format!("Section {i}")));
        }

        let tree = tree.freeze();
        let sections = tree.par_sections();
        assert_eq!(sections.len(), 100);
    }
}
