//! Cross-reference resolution.

use std::fmt::Write;

use crate::NodeId;
use crate::tree::{DocumentNode, DocumentTree, SectionPath};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReferenceQuery<'a> {
    Anchor(&'a str),
    Section(SectionPath),
    Figure(SectionPath),
    Fuzzy(&'a str),
}

impl<'a> ReferenceQuery<'a> {
    fn strip_prefix(value: &'a str, prefix: &str) -> Option<&'a str> {
        (value.len() >= prefix.len())
            .then(|| value.split_at(prefix.len()))
            .and_then(|(head, tail)| head.eq_ignore_ascii_case(prefix).then_some(tail))
    }

    fn parse_section(value: &'a str) -> Option<SectionPath> {
        let rest = Self::strip_prefix(value, "section")?;
        let rest = rest.strip_prefix(char::is_whitespace)?.trim();
        (!rest.is_empty()).then_some(rest)?.parse().ok()
    }

    fn parse_figure(value: &'a str) -> Option<SectionPath> {
        let rest = Self::strip_prefix(value, "fig")
            .filter(|rest| !rest.starts_with("ure"))
            .or_else(|| Self::strip_prefix(value, "figure"))?;
        let rest = rest.strip_prefix('.').unwrap_or(rest);
        let rest = rest.strip_prefix(char::is_whitespace)?.trim();
        (!rest.is_empty()).then_some(rest)?.parse().ok()
    }

    #[must_use]
    pub fn parse(reference: &'a str) -> Self {
        let trimmed = reference.trim();
        if let Some(value) = trimmed.strip_prefix('#').map(str::trim)
            && !value.is_empty()
        {
            return Self::Anchor(value);
        }
        if let Some(path) = Self::parse_section(trimmed) {
            return Self::Section(path);
        }
        if let Some(path) = Self::parse_figure(trimmed) {
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
    fn figure_anchor(path: &SectionPath) -> String {
        let mut out = String::from("fig");
        for idx in path.iter() {
            let _ = write!(out, "-{}", idx.get());
        }
        out
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
                    return path.iter().next().and_then(|idx| self.tree.figure(idx));
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
    fn parse_queries() {
        assert_eq!(ReferenceQuery::parse(" #intro "), ReferenceQuery::Anchor("intro"));
        assert_eq!(
            ReferenceQuery::parse("Section 1.2"),
            ReferenceQuery::Section("1.2".parse().unwrap())
        );
        assert_eq!(ReferenceQuery::parse("fig. 2"), ReferenceQuery::Figure("2".parse().unwrap()));
        assert_eq!(
            ReferenceQuery::parse("Figure 3.1"),
            ReferenceQuery::Figure("3.1".parse().unwrap())
        );
        assert_eq!(ReferenceQuery::parse("figure1"), ReferenceQuery::Fuzzy("figure1"));
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
