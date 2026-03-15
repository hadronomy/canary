//! PDF to Markdown to Tree parsing

use indextree::NodeId;
use rushdown::ast::{Arena as MdArena, NodeRef};

use crate::error::Result;
use crate::tree::{ColumnAlign, DocumentNode, DocumentTree, NodeKind};

/// Parser configuration
///
/// # Examples
///
/// ```
/// use pdf_hierarchy::TreeParser;
///
/// let parser = TreeParser::new()
///     .detect_headings(true);
/// ```
#[derive(Debug, Clone)]
pub struct TreeParser {
    detect_headings: bool,
}

impl TreeParser {
    /// Create default parser
    pub fn new() -> Self {
        Self { detect_headings: true }
    }

    /// Enable/disable heading detection from PDF font sizes
    pub fn detect_headings(mut self, enable: bool) -> Self {
        self.detect_headings = enable;
        self
    }

    /// Parse PDF file to tree
    ///
    /// # Errors
    ///
    /// Returns Err if PDF cannot be read or parsed
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use pdf_hierarchy::TreeParser;
    ///
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// let parser = TreeParser::new();
    /// let tree = parser.parse_file("doc.pdf")?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn parse_file<P: AsRef<std::path::Path>>(&self, path: P) -> Result<DocumentTree> {
        let markdown = self.extract_markdown(path)?;
        self.parse_markdown(&markdown)
    }

    /// Parse PDF from bytes
    pub fn parse_bytes(&self, bytes: &[u8]) -> Result<DocumentTree> {
        let mut doc = pdf_oxide::PdfDocument::open_bytes(bytes)?;
        let markdown = doc.to_markdown(0, self.detect_headings)?;
        self.parse_markdown(&markdown)
    }

    fn extract_markdown<P: AsRef<std::path::Path>>(&self, path: P) -> Result<String> {
        let mut doc = pdf_oxide::PdfDocument::open(path.as_ref())?;
        Ok(doc.to_markdown(0, self.detect_headings)?)
    }

    /// Parse markdown string to tree
    ///
    /// This is useful if you already have markdown content from another source.
    pub fn parse_markdown(&self, markdown: &str) -> Result<DocumentTree> {
        let options = rushdown::parser::Options::default();
        let (md_arena, md_root) = rushdown::ast::parse(markdown, &options)
            .map_err(|e| crate::error::DocumentError::Markdown(e.to_string()))?;

        let mut tree = DocumentTree::new();
        self.convert_node(&md_arena, md_root, &mut tree, tree.root())?;

        Ok(tree)
    }

    fn convert_node(
        &self,
        md_arena: &MdArena,
        md_node: NodeRef,
        tree: &mut DocumentTree,
        parent_id: NodeId,
    ) -> Result<()> {
        use rushdown::ast::Node;

        let node_data = md_arena.get(md_node).ok_or_else(|| {
            crate::error::DocumentError::Markdown("Invalid node reference".to_string())
        })?;

        let (node, skip_children) = match &node_data.data {
            Node::Document => (DocumentNode::new(NodeKind::Root, ""), false),

            Node::Heading { level, .. } => {
                let title = self.extract_text(md_arena, md_node);
                (DocumentNode::section(*level as u8, &title), false)
            }

            Node::Paragraph => {
                let text = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::Paragraph, text), false)
            }

            Node::List { ordered, tight, .. } => {
                let content = self.extract_text(md_arena, md_node);
                (
                    DocumentNode {
                        kind: NodeKind::List { ordered: *ordered, tight: *tight },
                        content,
                        anchor: None,
                        source_pos: None,
                        page_hint: None,
                    },
                    false,
                )
            }

            Node::Item => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::ListItem, content), false)
            }

            Node::CodeBlock { info, literal, .. } => {
                let lang = if info.is_empty() { None } else { Some(info.to_string()) };
                let mut node = DocumentNode::new(NodeKind::CodeBlock { language: lang }, "");
                node.content = literal.to_string();
                (node, true)
            }

            Node::BlockQuote => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::BlockQuote, content), false)
            }

            Node::Text(text) => {
                (DocumentNode::new(NodeKind::Text(text.to_string()), text.to_string()), true)
            }

            Node::Strong => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::Strong, content), false)
            }

            Node::Emph => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::Emphasis, content), false)
            }

            Node::Link { url, title, .. } => {
                let content = self.extract_text(md_arena, md_node);
                let mut node = DocumentNode::new(
                    NodeKind::Link {
                        url: url.to_string(),
                        title: if title.is_empty() { None } else { Some(title.to_string()) },
                    },
                    content,
                );
                node.anchor = Some(format!("link-{}", DocumentNode::slugify(url)));
                (node, false)
            }

            Node::Image { url, alt, .. } => {
                let mut node = DocumentNode::new(
                    NodeKind::Image { url: url.to_string(), alt: alt.to_string() },
                    alt.to_string(),
                );
                node.anchor = Some(format!("fig-{}", DocumentNode::slugify(alt)));
                (node, true)
            }

            Node::ThematicBreak => (DocumentNode::new(NodeKind::ThematicBreak, ""), true),

            Node::Table { alignments, .. } => {
                let aligns = alignments
                    .iter()
                    .map(|a| match a {
                        rushdown::ast::Alignment::Left => ColumnAlign::Left,
                        rushdown::ast::Alignment::Center => ColumnAlign::Center,
                        rushdown::ast::Alignment::Right => ColumnAlign::Right,
                        rushdown::ast::Alignment::None => ColumnAlign::None,
                    })
                    .collect();
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::Table { alignments: aligns }, content), false)
            }

            Node::TableRow => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::TableRow, content), false)
            }

            Node::TableCell => {
                let content = self.extract_text(md_arena, md_node);
                (DocumentNode::new(NodeKind::TableCell, content), false)
            }

            Node::SoftBreak | Node::LineBreak => {
                (DocumentNode::new(NodeKind::Text(" ".to_string()), " "), true)
            }

            _ => (DocumentNode::new(NodeKind::Text(String::new()), ""), true),
        };

        let new_id = tree.add_child(parent_id, node);

        if !skip_children {
            if let Some(child) = node_data.first_child {
                self.convert_node(md_arena, child, tree, new_id)?;
            }
        }

        if let Some(sibling) = node_data.next_sibling {
            self.convert_node(md_arena, sibling, tree, parent_id)?;
        }

        Ok(())
    }

    fn extract_text(&self, arena: &MdArena, node: NodeRef) -> String {
        let mut texts = Vec::new();
        self.collect_text(arena, node, &mut texts);
        texts.join(" ").trim().to_string()
    }

    fn collect_text(&self, arena: &MdArena, node: NodeRef, acc: &mut Vec<String>) {
        let Some(data) = arena.get(node) else { return };

        if let rushdown::ast::Node::Text(text) = &data.data {
            acc.push(text.to_string());
        }

        if let Some(child) = data.first_child {
            self.collect_text(arena, child, acc);
        }
        if let Some(sibling) = data.next_sibling {
            self.collect_text(arena, sibling, acc);
        }
    }
}

impl Default for TreeParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown_simple() {
        let md = r#"# Introduction
This is a paragraph.
## Methods
Some **bold** text.
"#;

        let parser = TreeParser::new();
        let tree = parser.parse_markdown(md).unwrap();

        let sections = tree.sections();
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].1, "introduction");
        assert_eq!(sections[1].1, "methods");
    }

    #[test]
    fn test_parse_markdown_nested() {
        let md = r#"# Root
## Child A
### Grandchild
## Child B
"#;

        let parser = TreeParser::new();
        let tree = parser.parse_markdown(md).unwrap();

        assert_eq!(tree.find_by_path("1").unwrap(), tree.find_by_anchor("root").unwrap());
        assert!(tree.find_by_path("1.1").is_ok());
        assert!(tree.find_by_path("1.1.1").is_ok());
        assert!(tree.find_by_path("1.2").is_ok());
    }

    #[test]
    fn test_list_parsing() {
        let md = r#"# List Test
- Item 1
- Item 2
  - Nested
"#;

        let parser = TreeParser::new();
        let tree = parser.parse_markdown(md).unwrap();

        let root_children: Vec<_> = tree.children(tree.root()).collect();
        assert!(!root_children.is_empty());
    }

    #[test]
    fn test_code_block() {
        let md = r#"# Code
```rust
fn main() {}"#;

        let parser = TreeParser::new();
        let tree = parser.parse_markdown(md).unwrap();

        let code_id = tree
            .descendants(tree.root())
            .find(|&id| matches!(tree.get(id).map(|n| &n.kind), Some(NodeKind::CodeBlock { .. })));
        assert!(code_id.is_some());
    }
}
