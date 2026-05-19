//! Cross-reference resolution.

use std::sync::LazyLock;

use regex::Regex;

use crate::NodeId;
use crate::tree::{DocumentNode, DocumentTree, SectionPath};

static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#(.+)$").unwrap());
static SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[Ss]ection\s+(\d+(?:\.\d+)*)$").unwrap());
static FIGURE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[Ff]ig(?:ure)?\.?\s+(\d+(?:\.\d+)*)$").unwrap());

/// Resolves cross-references like `Section 1.2` or `#intro` to `NodeId`s.
pub struct CrossRefResolver<'a> {
    tree: &'a DocumentTree,
}

impl<'a> CrossRefResolver<'a> {
    fn figure(&self, idx: usize) -> Option<NodeId> {
        self.tree
            .descendants(self.tree.root())
            .filter(|id| {
                self.tree.get(*id).is_some_and(|node| matches!(node, DocumentNode::Image { .. }))
            })
            .nth(idx.saturating_sub(1))
    }

    fn figure_anchor(path: &SectionPath) -> String {
        format!("fig-{}", path.to_string().replace('.', "-"))
    }

    /// Create a resolver for a tree.
    pub fn new(tree: &'a DocumentTree) -> Self {
        Self { tree }
    }

    /// Resolve a reference string to a `NodeId`.
    pub fn resolve(&self, reference: &str) -> Option<NodeId> {
        let trimmed = reference.trim();

        if let Some(caps) = ANCHOR_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
        {
            return self.tree.find_by_anchor(m.as_str());
        }

        if let Some(caps) = SECTION_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
        {
            let target = m.as_str();
            if let Some(id) = self.tree.find_by_anchor(target) {
                return Some(id);
            }
            if let Ok(path) = target.parse::<SectionPath>() {
                return self.tree.find_by_path(&path).ok();
            }
        }

        if let Some(caps) = FIGURE_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
            && let Ok(path) = m.as_str().parse::<SectionPath>()
        {
            if let Some(id) = self.tree.find_by_anchor(&Self::figure_anchor(&path)) {
                return Some(id);
            }
            if path.depth() == 1 {
                return self.figure(path.segments()[0]);
            }
        }

        self.tree.find_by_anchor(&DocumentNode::slugify(trimmed))
    }

    /// Get the breadcrumb trail from root to the containing section path.
    pub fn breadcrumbs(&self, id: NodeId) -> Vec<(String, String)> {
        let mut out = self
            .tree
            .ancestors(id)
            .filter(|id| *id != self.tree.root())
            .filter_map(|id| {
                let node = self.tree.get(id)?;
                let anchor = node.anchor()?.to_string();
                let title = node.section_title()?.to_string();
                Some((anchor, title))
            })
            .collect::<Vec<_>>();
        out.reverse();
        out
    }

    /// Find all links pointing at the given anchor.
    pub fn find_references_to(&self, target_anchor: &str) -> Vec<NodeId> {
        let hash = format!("#{target_anchor}");
        self.tree
            .descendants(self.tree.root())
            .filter(|id| {
                self.tree
                    .get(*id)
                    .and_then(DocumentNode::link_url)
                    .is_some_and(|url| url == target_anchor || url == hash.as_str())
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> DocumentTree {
        let mut tree = DocumentTree::new();
        let a = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
        let b = tree.add_child(a, DocumentNode::section(2, "B"));
        let c = tree.add_child(b, DocumentNode::section(3, "C"));
        let para = tree.add_child(c, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("Text"));
        let fig = tree.add_child(a, DocumentNode::image("image.png", "Caption"));
        let _ = tree.set_anchor(fig, Some("fig-caption".to_string()));
        let link = tree.add_child(b, DocumentNode::link("fig-caption", None));
        tree.add_child(link, DocumentNode::text("ref"));
        tree
    }

    #[test]
    fn resolve_anchor() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("#a"), tree.find_by_anchor("a"));
        assert_eq!(resolver.resolve("#b"), tree.find_by_anchor("b"));
        assert!(resolver.resolve("#nonexistent").is_none());
    }

    #[test]
    fn resolve_section_path() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("Section 1"), tree.find_by_path(&"1".parse().unwrap()).ok());
        assert_eq!(
            resolver.resolve("section 1.1"),
            tree.find_by_path(&"1.1".parse().unwrap()).ok()
        );
        assert_eq!(
            resolver.resolve("Section 1.1.1"),
            tree.find_by_path(&"1.1.1".parse().unwrap()).ok()
        );
    }

    #[test]
    fn resolve_figure() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        let fig = tree.find_by_anchor("fig-caption");
        assert!(fig.is_some());
        assert_eq!(resolver.resolve("Figure 1"), fig);
        assert_eq!(resolver.resolve("Fig. 1"), fig);
    }

    #[test]
    fn breadcrumbs() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        let text = tree
            .descendants(tree.root())
            .find(|id| tree.get(*id).and_then(DocumentNode::display_text) == Some("Text"))
            .unwrap();

        let crumbs = resolver.breadcrumbs(text);
        assert_eq!(crumbs.len(), 3);
        assert_eq!(crumbs[0].0, "a");
        assert_eq!(crumbs[1].0, "b");
        assert_eq!(crumbs[2].0, "c");
    }
}
