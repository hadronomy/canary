//! Cross-reference resolution

use indextree::NodeId;
use regex::Regex;

use crate::error::Result;
use crate::tree::{DocumentNode, DocumentTree};

/// Resolves cross-references like "Section 1.2" or "#intro" to NodeIds
///
/// # Examples
///
/// ```
/// use pdf_hierarchy::{TreeParser, CrossRefResolver};
///
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let parser = TreeParser::new();
/// let tree = parser.parse_markdown("# Introduction\n## Methods")?;
/// let resolver = CrossRefResolver::new(&tree);
///
/// // By anchor
/// assert!(resolver.resolve("#introduction").is_some());
///
/// // By path
/// assert!(resolver.resolve("Section 1").is_some());
/// # Ok(())
/// # }
/// ```
pub struct CrossRefResolver<'a> {
    tree: &'a DocumentTree,
    patterns: Vec<(Regex, Box<dyn Fn(&str) -> Option<String>>)>,
}

impl<'a> CrossRefResolver<'a> {
    /// Create resolver for a tree
    pub fn new(tree: &'a DocumentTree) -> Self {
        let patterns = vec![
            // "#anchor" format
            (
                Regex::new(r"^#(.+)$").unwrap(),
                Box::new(|s: &str| Some(s.to_string())) as Box<dyn Fn(&str) -> Option<String>>,
            ),
            // "Section X.Y.Z" format
            (
                Regex::new(r"^[Ss]ection\s+(\d+(?:\.\d+)*)$").unwrap(),
                Box::new(|s: &str| Some(s.to_string())),
            ),
            // "Fig/Figure X" format
            (
                Regex::new(r"^[Ff]ig(?:ure)?\.?\s+(\d+(?:\.\d+)*)$").unwrap(),
                Box::new(|s: &str| Some(format!("fig-{}", s.replace('.', "-")))),
            ),
        ];

        Self { tree, patterns }
    }

    /// Resolve a reference string to a NodeId
    ///
    /// Supports formats:
    /// - `#anchor` (direct anchor link)
    /// - `Section 1.2.3` (hierarchical path)
    /// - `Figure 1` (with auto-slugification)
    pub fn resolve(&self, reference: &str) -> Option<NodeId> {
        let trimmed = reference.trim();

        for (regex, transform) in &self.patterns {
            if let Some(caps) = regex.captures(trimmed) {
                if let Some(m) = caps.get(1) {
                    if let Some(target) = transform(m.as_str()) {
                        // Try as anchor first
                        if let Some(id) = self.tree.find_by_anchor(&target) {
                            return Some(id);
                        }
                        // Try as path
                        if let Ok(id) = self.tree.find_by_path(&target) {
                            return Some(id);
                        }
                    }
                }
            }
        }

        // Fuzzy match on section titles
        let slug = DocumentNode::slugify(trimmed);
        self.tree.find_by_anchor(&slug)
    }

    /// Get breadcrumb trail from root to parent of given node
    ///
    /// Returns vector of (anchor, title) tuples
    ///
    /// # Examples
    ///
    /// ```
    /// use pdf_hierarchy::{TreeParser, CrossRefResolver, DocumentNode};
    ///
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let parser = TreeParser::new();
    /// let tree = parser.parse_markdown("# A\n## B\n### C")?;
    /// let resolver = CrossRefResolver::new(&tree);
    ///
    /// let c_id = tree.find_by_anchor("c").unwrap();
    /// let crumbs = resolver.breadcrumbs(c_id);
    ///
    /// assert_eq!(crumbs.len(), 2); // A and B (C is the node itself, not in breadcrumbs)
    /// assert_eq!(crumbs[0].1, "A");
    /// assert_eq!(crumbs[1].1, "B");
    /// # Ok(())
    /// }
    pub fn breadcrumbs(&self, id: NodeId) -> Vec<(String, String)> {
        self.tree
            .ancestors(id)
            .filter(|&aid| aid != self.tree.root())
            .filter_map(|aid| {
                let node = self.tree.get(aid)?;
                let anchor = node.anchor.clone()?;
                let title = match &node.kind {
                    crate::tree::NodeKind::Section { title, .. } => title.clone(),
                    _ => node.content.clone(),
                };
                Some((anchor, title))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Find all nodes linking to a specific anchor (reverse lookup)
    ///
    /// Note: This scans the entire tree. For large documents, consider
    /// building an index separately.
    pub fn find_references_to(&self, target_anchor: &str) -> Vec<NodeId> {
        self.tree
            .descendants(self.tree.root())
            .filter(|&id| {
                self.tree
                    .get(id)
                    .map(|node| {
                        if let crate::tree::NodeKind::Link { url, .. } = &node.kind {
                            url == target_anchor || url == &format!("#{}", target_anchor)
                        } else {
                            false
                        }
                    })
                    .unwrap_or(false)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TreeParser;

    #[test]
    fn test_resolve_anchor() {
        let parser = TreeParser::new();
        let tree = parser.parse_markdown("# Introduction\n## Methods").unwrap();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("#introduction"), tree.find_by_anchor("introduction"));
        assert_eq!(resolver.resolve("#methods"), tree.find_by_anchor("methods"));
        assert!(resolver.resolve("#nonexistent").is_none());
    }

    #[test]
    fn test_resolve_section_path() {
        let parser = TreeParser::new();
        let tree = parser.parse_markdown("# First\n## Second\n### Third").unwrap();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("Section 1"), tree.find_by_path("1"));
        assert_eq!(resolver.resolve("section 1.1"), tree.find_by_path("1.1"));
        assert_eq!(resolver.resolve("Section 1.1.1"), tree.find_by_path("1.1.1"));
    }

    #[test]
    fn test_resolve_figure() {
        let parser = TreeParser::new();
        let md = r#"# Doc
![Caption](image.png)
"#;
        let tree = parser.parse_markdown(md).unwrap();
        let resolver = CrossRefResolver::new(&tree);

        // Images get fig- anchors
        let fig_id = tree.find_by_anchor("fig-caption");
        assert!(fig_id.is_some());

        // Should resolve via "Figure" reference
        assert_eq!(resolver.resolve("Figure 1"), fig_id);
        assert_eq!(resolver.resolve("Fig. 1"), fig_id);
    }

    #[test]
    fn test_breadcrumbs() {
        let parser = TreeParser::new();
        let tree = parser.parse_markdown("# A\n## B\n### C\nText").unwrap();
        let resolver = CrossRefResolver::new(&tree);

        let text_id = tree
            .descendants(tree.root())
            .find(|&id| tree.get(id).map(|n| n.content == "Text").unwrap_or(false))
            .unwrap();

        let crumbs = resolver.breadcrumbs(text_id);
        assert_eq!(crumbs.len(), 3);
        assert_eq!(crumbs[0].0, "a");
        assert_eq!(crumbs[1].0, "b");
        assert_eq!(crumbs[2].0, "c");
    }
}
