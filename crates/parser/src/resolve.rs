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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceQuery<'a> {
    Anchor(&'a str),
    Section(SectionPath),
    Figure(SectionPath),
    Fuzzy(&'a str),
}

impl<'a> ReferenceQuery<'a> {
    #[must_use]
    pub fn parse(reference: &'a str) -> Self {
        let trimmed = reference.trim();

        if let Some(caps) = ANCHOR_RE.captures(trimmed)
            && let Some(value) = caps.get(1)
        {
            return Self::Anchor(value.as_str());
        }

        if let Some(caps) = SECTION_RE.captures(trimmed)
            && let Some(value) = caps.get(1)
            && let Ok(path) = value.as_str().parse::<SectionPath>()
        {
            return Self::Section(path);
        }

        if let Some(caps) = FIGURE_RE.captures(trimmed)
            && let Some(value) = caps.get(1)
            && let Ok(path) = value.as_str().parse::<SectionPath>()
        {
            return Self::Figure(path);
        }

        Self::Fuzzy(trimmed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Breadcrumb<'a> {
    pub anchor: &'a str,
    pub title: &'a str,
    pub path: SectionPath,
}

/// Resolves cross-references like `Section 1.2` or `#intro` to `NodeId`s.
pub struct CrossRefResolver<'a> {
    tree: &'a DocumentTree,
}

impl<'a> CrossRefResolver<'a> {
    fn figure(&self, idx: usize) -> Option<NodeId> {
        self.tree
            .descendants(self.tree.root())
            .filter(|node| matches!(node.data(), DocumentNode::Image { .. }))
            .nth(idx.saturating_sub(1))
            .map(|node| node.id())
    }

    fn figure_anchor(path: &SectionPath) -> String {
        format!("fig-{}", path.segments().map(|idx| idx.to_string()).collect::<Vec<_>>().join("-"))
    }

    /// Create a resolver for a tree.
    pub fn new(tree: &'a DocumentTree) -> Self {
        Self { tree }
    }

    #[must_use]
    pub fn parse(&self, reference: &'a str) -> ReferenceQuery<'a> {
        ReferenceQuery::parse(reference)
    }

    /// Resolve a parsed reference query to a `NodeId`.
    pub fn resolve_query(&self, query: &ReferenceQuery<'_>) -> Option<NodeId> {
        match query {
            ReferenceQuery::Anchor(anchor) => self.tree.find_by_anchor(anchor),
            ReferenceQuery::Section(path) => self.tree.find_by_path(path).ok(),
            ReferenceQuery::Figure(path) => {
                if let Some(id) = self.tree.find_by_anchor(&Self::figure_anchor(path)) {
                    return Some(id);
                }
                if path.depth() == 1 {
                    return path.segments().next().and_then(|idx| self.figure(idx));
                }
                None
            }
            ReferenceQuery::Fuzzy(value) => self.tree.find_by_anchor(&DocumentNode::slugify(value)),
        }
    }

    /// Resolve a reference string to a `NodeId`.
    pub fn resolve(&self, reference: &'a str) -> Option<NodeId> {
        let query = self.parse(reference);
        self.resolve_query(&query)
    }

    /// Get the breadcrumb trail from root to the containing section path.
    pub fn breadcrumbs(&self, id: NodeId) -> Vec<Breadcrumb<'a>> {
        let mut out = self
            .tree
            .ancestors(id)
            .filter(|node| node.id() != self.tree.root())
            .filter_map(|node| {
                let anchor = node.anchor()?;
                let title = node.section_title()?;
                Some(Breadcrumb { anchor, title, path: node.path() })
            })
            .collect::<Vec<_>>();
        out.reverse();
        out
    }

    /// Find all links pointing at the given anchor.
    pub fn find_references_to(&self, target_anchor: &str) -> Vec<NodeId> {
        self.tree.find_references_to(target_anchor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::{Anchor, DocumentTree};

    fn tree() -> DocumentTree {
        let mut tree = DocumentTree::builder();
        let a = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
        let b = tree.add_child(a, DocumentNode::section(2, "B"));
        let c = tree.add_child(b, DocumentNode::section(3, "C"));
        let para = tree.add_child(c, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("Text"));
        let fig = tree.add_child(a, DocumentNode::image("image.png", "Caption"));
        let _ = tree.set_anchor(fig, Some(Anchor::from("fig-caption")));
        let link = tree.add_child(b, DocumentNode::link_anchor("fig-caption", None));
        tree.add_child(link, DocumentNode::text("ref"));
        tree.freeze()
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
            .find(|node| node.display_text() == Some("Text"))
            .unwrap()
            .id();

        let crumbs = resolver.breadcrumbs(text);
        assert_eq!(crumbs.len(), 3);
        assert_eq!(crumbs[0].anchor, "a");
        assert_eq!(crumbs[1].anchor, "b");
        assert_eq!(crumbs[2].anchor, "c");
    }
}
