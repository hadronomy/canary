//! Cross-reference resolution

use std::sync::LazyLock;

use regex::Regex;

use crate::tree::{DocumentNode, DocumentTree};
use crate::NodeId;

static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#(.+)$").unwrap());
static SECTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[Ss]ection\s+(\d+(?:\.\d+)*)$").unwrap());
static FIGURE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[Ff]ig(?:ure)?\.?\s+(\d+(?:\.\d+)*)$").unwrap());

/// Resolves cross-references like "Section 1.2" or "#intro" to NodeIds
///
/// # Examples
///
/// ```
/// use document_hierarchy::{TreeParser, CrossRefResolver};
///
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let parser = TreeParser::new();
/// let xml = r#"<response><data><texto>
///   <bloque id='intro' tipo='encabezado' titulo='Introduction'><version fecha_vigencia='20200101'><p class='titulo'>Introduction</p></version></bloque>
///   <bloque id='methods' tipo='encabezado' titulo='Methods'><version fecha_vigencia='20200101'><p class='capitulo'>Methods</p></version></bloque>
/// </texto></data></response>"#;
/// let tree = parser.parse_xml(xml)?;
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
}

impl<'a> CrossRefResolver<'a> {
    fn figure(&self, target: &str) -> Option<NodeId> {
        let idx = target
            .strip_prefix("fig-")
            .and_then(|s| s.split('-').next())
            .and_then(|s| s.parse::<usize>().ok())?;
        if idx == 0 {
            return None;
        }
        self.tree
            .descendants(self.tree.root())
            .filter(|&id| {
                self.tree
                    .get(id)
                    .map(|node| matches!(&node.kind, crate::tree::NodeKind::Image { .. }))
                    .unwrap_or(false)
            })
            .nth(idx - 1)
    }

    /// Create resolver for a tree
    pub fn new(tree: &'a DocumentTree) -> Self {
        Self { tree }
    }

    /// Resolve a reference string to a NodeId
    ///
    /// Supports formats:
    /// - `#anchor` (direct anchor link)
    /// - `Section 1.2.3` (hierarchical path)
    /// - `Figure 1` (with auto-slugification)
    pub fn resolve(&self, reference: &str) -> Option<NodeId> {
        let trimmed = reference.trim();

        if let Some(caps) = ANCHOR_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
            && let Some(id) = self.tree.find_by_anchor(m.as_str())
        {
            return Some(id);
        }

        if let Some(caps) = SECTION_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
        {
            let target = m.as_str();
            if let Some(id) = self.tree.find_by_anchor(target) {
                return Some(id);
            }
            if let Ok(id) = self.tree.find_by_path(target) {
                return Some(id);
            }
        }

        if let Some(caps) = FIGURE_RE.captures(trimmed)
            && let Some(m) = caps.get(1)
        {
            let target = format!("fig-{}", m.as_str().replace('.', "-"));
            if let Some(id) = self.tree.find_by_anchor(&target) {
                return Some(id);
            }
            if let Some(id) = self.figure(&target) {
                return Some(id);
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
    /// use document_hierarchy::{TreeParser, CrossRefResolver, DocumentNode};
    ///
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let parser = TreeParser::new();
    /// let xml = r#"<response><data><texto>
    ///   <bloque id='a' tipo='encabezado' titulo='A'><version fecha_vigencia='20200101'><p class='titulo'>A</p></version></bloque>
    ///   <bloque id='b' tipo='encabezado' titulo='B'><version fecha_vigencia='20200101'><p class='capitulo'>B</p></version></bloque>
    ///   <bloque id='c' tipo='encabezado' titulo='C'><version fecha_vigencia='20200101'><p class='seccion'>C</p><p class='parrafo'>Text</p></version></bloque>
    /// </texto></data></response>"#;
    /// let tree = parser.parse_xml(xml)?;
    /// let resolver = CrossRefResolver::new(&tree);
    ///
    /// let c_id = tree.find_by_anchor("c").unwrap();
    /// let crumbs = resolver.breadcrumbs(c_id);
    ///
    /// assert_eq!(crumbs.len(), 3);
    /// assert_eq!(crumbs[0].1, "A");
    /// assert_eq!(crumbs[1].1, "B");
    /// assert_eq!(crumbs[2].1, "C");
    /// # Ok(())
    /// }
    pub fn breadcrumbs(&self, id: NodeId) -> Vec<(String, String)> {
        let mut out = self
            .tree
            .ancestors(id)
            .filter(|&aid| aid != self.tree.root())
            .filter_map(|aid| {
                let node = self.tree.get(aid)?;
                let anchor = node.anchor.clone()?;
                let title = node.content.clone();
                Some((anchor, title))
            })
            .collect::<Vec<_>>();
        out.reverse();
        out
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
                        node.link_url().is_some_and(|url| {
                            let hash = format!("#{}", target_anchor);
                            url == target_anchor || url == hash.as_str()
                        })
                    })
                    .unwrap_or(false)
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
        tree.add_child(c, DocumentNode::new(crate::tree::NodeKind::Paragraph, "Text"));
        let fig = tree.add_child(
            a,
            DocumentNode::image("image.png", "Caption"),
        );
        let _ = tree.set_anchor(fig, Some("fig-caption".to_string()));
        tree.add_child(
            b,
            DocumentNode::link("fig-caption", None, "ref"),
        );
        assert!(tree.find_by_anchor("fig-caption").is_some());
        assert_eq!(tree.find_by_anchor("fig-caption"), Some(fig));
        tree
    }

    #[test]
    fn test_resolve_anchor() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("#a"), tree.find_by_anchor("a"));
        assert_eq!(resolver.resolve("#b"), tree.find_by_anchor("b"));
        assert!(resolver.resolve("#nonexistent").is_none());
    }

    #[test]
    fn test_resolve_section_path() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        assert_eq!(resolver.resolve("Section 1"), tree.find_by_path("1").ok());
        assert_eq!(resolver.resolve("section 1.1"), tree.find_by_path("1.1").ok());
        assert_eq!(resolver.resolve("Section 1.1.1"), tree.find_by_path("1.1.1").ok());
    }

    #[test]
    fn test_resolve_figure() {
        let tree = tree();
        let resolver = CrossRefResolver::new(&tree);

        let fig_id = tree.find_by_anchor("fig-caption");
        assert!(fig_id.is_some());

        assert_eq!(resolver.resolve("Figure 1"), fig_id);
        assert_eq!(resolver.resolve("Fig. 1"), fig_id);
    }

    #[test]
    fn test_breadcrumbs() {
        let tree = tree();
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
