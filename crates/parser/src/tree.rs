//! Core tree data structures and navigation.

use std::collections::HashMap;
use std::fmt;
use std::fmt::Write;
use std::ops::Index;
use std::str::FromStr;

use deunicode::deunicode;
use indextree::Arena;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::NodeId;
use crate::error::{DocumentError, Result};

/// Alignment for table columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ColumnAlign {
    Left,
    Center,
    Right,
}

pub type ColumnAlignment = Option<ColumnAlign>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum SectionKind {
    Titulo,
    Capitulo,
    Seccion,
    Articulo,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum NodeKind {
    Root,
    Section,
    Paragraph,
    Html,
    List,
    ListItem,
    CodeBlock,
    BlockQuote,
    Table,
    TableRow,
    TableCell,
    Text,
    Strong,
    Emphasis,
    Link,
    Image,
    ThematicBreak,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ListStyle {
    Ordered,
    Unordered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ListSpacing {
    Tight,
    Loose,
}

/// A typed document node.
///
/// Block containers no longer carry generic text payloads. Text lives in `Text`
/// leaves, and inline structure is preserved by child order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentNode {
    Root,
    Section { level: u8, kind: SectionKind, anchor: String, title: String },
    Paragraph,
    Html(String),
    List { style: ListStyle, spacing: ListSpacing },
    ListItem,
    CodeBlock { language: Option<String>, code: String },
    BlockQuote,
    Table { alignments: Vec<ColumnAlignment> },
    TableRow,
    TableCell,
    Text(String),
    Strong,
    Emphasis,
    Link { url: String, title: Option<String> },
    Image { anchor: Option<String>, url: String, alt: String },
    ThematicBreak,
}

impl DocumentNode {
    #[must_use]
    pub fn root() -> Self {
        Self::Root
    }

    #[must_use]
    pub fn paragraph() -> Self {
        Self::Paragraph
    }

    #[must_use]
    pub fn list(style: ListStyle, spacing: ListSpacing) -> Self {
        Self::List { style, spacing }
    }

    #[must_use]
    pub fn list_item() -> Self {
        Self::ListItem
    }

    #[must_use]
    pub fn code_block(language: Option<String>, code: impl Into<String>) -> Self {
        Self::CodeBlock { language, code: code.into() }
    }

    #[must_use]
    pub fn block_quote() -> Self {
        Self::BlockQuote
    }

    #[must_use]
    pub fn table(alignments: Vec<ColumnAlignment>) -> Self {
        Self::Table { alignments }
    }

    #[must_use]
    pub fn table_row() -> Self {
        Self::TableRow
    }

    #[must_use]
    pub fn table_cell() -> Self {
        Self::TableCell
    }

    #[must_use]
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text(text.into())
    }

    #[must_use]
    pub fn strong() -> Self {
        Self::Strong
    }

    #[must_use]
    pub fn emphasis() -> Self {
        Self::Emphasis
    }

    #[must_use]
    pub fn link(url: impl Into<String>, title: Option<String>) -> Self {
        Self::Link { url: url.into(), title }
    }

    #[must_use]
    pub fn image(url: impl Into<String>, alt: impl Into<String>) -> Self {
        Self::Image { anchor: None, url: url.into(), alt: alt.into() }
    }

    #[must_use]
    pub fn html(content: impl Into<String>) -> Self {
        Self::Html(content.into())
    }

    #[must_use]
    pub fn thematic_break() -> Self {
        Self::ThematicBreak
    }

    #[must_use]
    pub fn section(level: u8, title: impl AsRef<str>) -> Self {
        Self::section_with(level, SectionKind::Other, title)
    }

    #[must_use]
    pub fn section_with(level: u8, kind: SectionKind, title: impl AsRef<str>) -> Self {
        let title = title.as_ref();
        Self::Section { level, kind, anchor: Self::slugify(title), title: title.to_string() }
    }

    #[must_use]
    pub fn with_anchor(mut self, anchor: impl Into<String>) -> Self {
        let anchor = anchor.into();
        match &mut self {
            Self::Section { anchor: slot, .. } => *slot = anchor,
            Self::Image { anchor: slot, .. } => *slot = Some(anchor),
            _ => {}
        }
        self
    }

    #[must_use]
    pub fn slugify(text: &str) -> String {
        Self::slug(text.nfkc().flat_map(char::to_lowercase))
    }

    #[must_use]
    pub fn slugify_ascii(text: &str) -> String {
        Self::slug(deunicode(text).chars().flat_map(char::to_lowercase))
    }

    fn slug(iter: impl Iterator<Item = char>) -> String {
        let mut out = String::new();
        let mut dash = false;
        for ch in iter {
            if ch.is_alphanumeric() {
                out.push(ch);
                dash = false;
                continue;
            }
            if out.is_empty() || dash {
                continue;
            }
            out.push('-');
            dash = true;
        }
        if out.ends_with('-') {
            out.pop();
        }
        out
    }

    #[must_use]
    pub fn kind(&self) -> NodeKind {
        match self {
            Self::Root => NodeKind::Root,
            Self::Section { .. } => NodeKind::Section,
            Self::Paragraph => NodeKind::Paragraph,
            Self::Html(_) => NodeKind::Html,
            Self::List { .. } => NodeKind::List,
            Self::ListItem => NodeKind::ListItem,
            Self::CodeBlock { .. } => NodeKind::CodeBlock,
            Self::BlockQuote => NodeKind::BlockQuote,
            Self::Table { .. } => NodeKind::Table,
            Self::TableRow => NodeKind::TableRow,
            Self::TableCell => NodeKind::TableCell,
            Self::Text(_) => NodeKind::Text,
            Self::Strong => NodeKind::Strong,
            Self::Emphasis => NodeKind::Emphasis,
            Self::Link { .. } => NodeKind::Link,
            Self::Image { .. } => NodeKind::Image,
            Self::ThematicBreak => NodeKind::ThematicBreak,
        }
    }

    #[must_use]
    pub fn is_section(&self) -> bool {
        matches!(self, Self::Section { .. })
    }

    pub fn anchor(&self) -> Option<&str> {
        match self {
            Self::Section { anchor, .. } => Some(anchor.as_str()),
            Self::Image { anchor, .. } => anchor.as_deref(),
            _ => None,
        }
    }

    pub fn section_title(&self) -> Option<&str> {
        match self {
            Self::Section { title, .. } => Some(title.as_str()),
            _ => None,
        }
    }

    pub fn section_level(&self) -> Option<u8> {
        match self {
            Self::Section { level, .. } => Some(*level),
            _ => None,
        }
    }

    pub fn section_kind(&self) -> Option<SectionKind> {
        match self {
            Self::Section { kind, .. } => Some(*kind),
            _ => None,
        }
    }

    pub fn link_url(&self) -> Option<&str> {
        match self {
            Self::Link { url, .. } => Some(url.as_str()),
            _ => None,
        }
    }

    pub fn image_url(&self) -> Option<&str> {
        match self {
            Self::Image { url, .. } => Some(url.as_str()),
            _ => None,
        }
    }

    pub fn display_text(&self) -> Option<&str> {
        match self {
            Self::Section { title, .. } => Some(title.as_str()),
            Self::Html(html) => Some(html.as_str()),
            Self::CodeBlock { code, .. } => Some(code.as_str()),
            Self::Text(text) => Some(text.as_str()),
            Self::Image { alt, .. } => Some(alt.as_str()),
            _ => None,
        }
    }

    fn set_anchor(&mut self, anchor: Option<String>) -> bool {
        match self {
            Self::Section { anchor: slot, .. } => {
                let Some(anchor) = anchor else {
                    return false;
                };
                *slot = anchor;
                true
            }
            Self::Image { anchor: slot, .. } => {
                *slot = anchor;
                true
            }
            _ => false,
        }
    }
}

/// A typed section path such as `1.2.3`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct SectionPath(Vec<usize>);

impl SectionPath {
    #[must_use]
    pub fn root() -> Self {
        Self(Vec::new())
    }

    #[must_use]
    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    #[must_use]
    pub fn depth(&self) -> usize {
        self.0.len()
    }

    #[must_use]
    pub fn segments(&self) -> &[usize] {
        &self.0
    }

    fn from_parts(parts: Vec<usize>) -> Self {
        Self(parts)
    }
}

impl fmt::Display for SectionPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_root() {
            return f.write_str("root");
        }
        for (idx, part) in self.0.iter().enumerate() {
            if idx > 0 {
                f.write_str(".")?;
            }
            write!(f, "{part}")?;
        }
        Ok(())
    }
}

impl FromStr for SectionPath {
    type Err = DocumentError;

    fn from_str(path: &str) -> Result<Self> {
        if path == "root" {
            return Ok(Self::root());
        }
        if path.is_empty() {
            return Err(DocumentError::InvalidPath {
                path: path.to_string(),
                reason: "path is empty".to_string(),
            });
        }

        let mut parts = Vec::new();
        for part in path.split('.') {
            let idx = part.parse::<usize>().map_err(|_| DocumentError::InvalidPath {
                path: path.to_string(),
                reason: format!("`{part}` is not a number"),
            })?;
            if idx == 0 {
                return Err(DocumentError::InvalidPath {
                    path: path.to_string(),
                    reason: "path indices are 1-based".to_string(),
                });
            }
            parts.push(idx);
        }

        Ok(Self(parts))
    }
}

/// Hierarchical document tree with anchor and section-path navigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTree {
    arena: Arena<DocumentNode>,
    root: indextree::NodeId,
    index: HashMap<String, indextree::NodeId>,
    alias: HashMap<String, indextree::NodeId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionEntry {
    pub id: NodeId,
    pub anchor: String,
    pub path: SectionPath,
    pub level: u8,
}

pub struct DescendantsIter<'a>(indextree::Descendants<'a, DocumentNode>);

impl Iterator for DescendantsIter<'_> {
    type Item = NodeId;

    fn next(&mut self) -> Option<Self::Item> {
        self.0.next().map(NodeId::from_raw)
    }
}

impl DocumentTree {
    #[must_use]
    pub fn new() -> Self {
        let mut arena = Arena::new();
        let root = arena.new_node(DocumentNode::root());
        Self { arena, root, index: HashMap::new(), alias: HashMap::new() }
    }

    #[inline]
    pub fn root(&self) -> NodeId {
        NodeId::from_raw(self.root)
    }

    pub fn arena(&self) -> &Arena<DocumentNode> {
        &self.arena
    }

    #[inline]
    pub fn node_count(&self) -> usize {
        self.arena.count()
    }

    pub fn rebuild_index(&mut self) {
        self.index.clear();
        self.alias.clear();
        let ids = self.root.descendants(&self.arena).collect::<Vec<_>>();
        for raw in ids {
            let id = NodeId::from_raw(raw);
            let anchor = self.get(id).and_then(DocumentNode::anchor).map(str::to_string);
            if let Some(anchor) = anchor {
                self.put_anchor(raw, &anchor);
            }
        }
    }

    pub fn get(&self, id: NodeId) -> Option<&DocumentNode> {
        self.arena.get(id.into_raw()).map(|node| node.get())
    }

    #[must_use]
    pub fn set_anchor(&mut self, id: NodeId, anchor: Option<String>) -> bool {
        let raw = id.into_raw();
        let (old, new) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return false;
            };
            let old = node.anchor().map(str::to_string);
            if !node.set_anchor(anchor) {
                return false;
            }
            let new = node.anchor().map(str::to_string);
            (old, new)
        };

        if old == new {
            return true;
        }
        if let Some(old) = old {
            self.drop_anchor(raw, &old);
        }
        if let Some(new) = new {
            self.put_anchor(raw, &new);
        }
        true
    }

    #[must_use]
    pub fn update<F>(&mut self, id: NodeId, f: F) -> bool
    where
        F: FnOnce(&mut DocumentNode),
    {
        let raw = id.into_raw();
        let (old, new) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return false;
            };
            let old = node.anchor().map(str::to_string);
            f(node);
            let new = node.anchor().map(str::to_string);
            (old, new)
        };

        if old == new {
            return true;
        }
        if let Some(old) = old {
            self.drop_anchor(raw, &old);
        }
        if let Some(new) = new {
            self.put_anchor(raw, &new);
        }
        true
    }

    pub fn add_child(&mut self, parent: NodeId, node: DocumentNode) -> NodeId {
        let parent = parent.into_raw();
        let anchor = node.anchor().map(str::to_string);
        let id = self.arena.new_node(node);
        parent.append(id, &mut self.arena);

        if let Some(anchor) = anchor {
            self.put_anchor(id, &anchor);
        }

        NodeId::from_raw(id)
    }

    #[must_use]
    pub fn find_by_anchor(&self, query: &str) -> Option<NodeId> {
        let lookup = |key: &str| self.index.get(key).or_else(|| self.alias.get(key)).copied();

        if let Some(id) = lookup(query) {
            return Some(NodeId::from_raw(id));
        }

        let slug = DocumentNode::slugify(query);
        if slug != query
            && let Some(id) = lookup(&slug)
        {
            return Some(NodeId::from_raw(id));
        }

        let ascii = DocumentNode::slugify_ascii(query);
        if ascii != query && ascii != slug {
            return lookup(&ascii).map(NodeId::from_raw);
        }

        None
    }

    pub fn get_anchor(&self, id: NodeId) -> Option<&str> {
        self.get(id).and_then(DocumentNode::anchor)
    }

    fn put_anchor(&mut self, id: indextree::NodeId, anchor: &str) {
        self.index.entry(anchor.to_string()).or_insert(id);
        let alias = DocumentNode::slugify_ascii(anchor);
        if alias != anchor {
            self.alias.entry(alias).or_insert(id);
        }
    }

    fn drop_anchor(&mut self, id: indextree::NodeId, anchor: &str) {
        if self.index.get(anchor) == Some(&id) {
            self.index.remove(anchor);
        }
        let alias = DocumentNode::slugify_ascii(anchor);
        if self.alias.get(&alias) == Some(&id) {
            self.alias.remove(&alias);
        }
    }

    fn section_child(&self, parent: indextree::NodeId, idx: usize) -> Option<indextree::NodeId> {
        parent
            .children(&self.arena)
            .filter(|child| {
                self.arena.get(*child).map(|node| node.get().is_section()).unwrap_or(false)
            })
            .nth(idx)
    }

    fn section_path(&self, id: NodeId) -> SectionPath {
        let mut out = Vec::new();
        let mut current = id.into_raw();
        while let Some(parent) = self.arena[current].parent() {
            let is_section =
                self.arena.get(current).map(|node| node.get().is_section()).unwrap_or(false);
            if is_section {
                let idx = parent
                    .children(&self.arena)
                    .filter(|child| {
                        self.arena.get(*child).map(|node| node.get().is_section()).unwrap_or(false)
                    })
                    .position(|child| child == current)
                    .unwrap_or(0);
                out.push(idx + 1);
            }
            current = parent;
        }
        out.reverse();
        SectionPath::from_parts(out)
    }

    #[must_use]
    pub fn path(&self, id: NodeId) -> SectionPath {
        self.section_path(id)
    }

    #[must_use]
    pub fn hierarchical_path(&self, id: NodeId) -> String {
        self.path(id).to_string()
    }

    pub fn descendants(&self, node: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        node.into_raw().descendants(&self.arena).map(NodeId::from_raw)
    }

    pub fn ancestors(&self, node: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        node.into_raw().ancestors(&self.arena).map(NodeId::from_raw)
    }

    pub fn children(&self, node: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        node.into_raw().children(&self.arena).map(NodeId::from_raw)
    }

    pub fn sections(&self) -> impl Iterator<Item = SectionEntry> + '_ {
        self.descendants(self.root()).filter_map(|id| {
            let node = self.get(id)?;
            let (Some(anchor), Some(level)) = (node.anchor(), node.section_level()) else {
                return None;
            };
            Some(SectionEntry { id, anchor: anchor.to_string(), path: self.path(id), level })
        })
    }

    pub fn find_by_path(&self, path: &SectionPath) -> Result<NodeId> {
        if path.is_root() {
            return Ok(self.root());
        }

        let mut current = self.root;
        for idx in path.segments() {
            let Some(child) = self.section_child(current, idx - 1) else {
                return Err(DocumentError::InvalidPath {
                    path: path.to_string(),
                    reason: format!("index {idx} is out of bounds"),
                });
            };
            current = child;
        }

        Ok(NodeId::from_raw(current))
    }

    pub fn parent_section(&self, id: NodeId) -> Option<NodeId> {
        self.ancestors(id).skip(1).find(|id| self.get(*id).is_some_and(DocumentNode::is_section))
    }

    pub fn extract_text(&self, id: NodeId) -> String {
        self.descendants(id)
            .filter_map(|id| self.get(id).and_then(DocumentNode::display_text))
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn debug_tree(&self) -> String {
        let mut out = String::new();
        self.debug_node(self.root(), 0, &mut out);
        out
    }

    fn debug_node(&self, id: NodeId, depth: usize, out: &mut String) {
        let indent = "  ".repeat(depth);
        let Some(node) = self.get(id) else {
            return;
        };

        let path = self.path(id);
        let anchor = node.anchor().map(|it| format!("[#{it}]")).unwrap_or_default();

        match node {
            DocumentNode::Root => {
                let _ = writeln!(out, "{}[{}] ROOT", indent, path);
            }
            DocumentNode::Section { level, title, .. } => {
                let _ = writeln!(out, "{}[{}]{} H{}: {}", indent, path, anchor, level, title);
            }
            DocumentNode::Text(text) => {
                let _ = writeln!(out, "{}[{}]{} TEXT: {}", indent, path, anchor, text);
            }
            DocumentNode::Html(html) => {
                let _ = writeln!(out, "{}[{}]{} HTML: {}", indent, path, anchor, html);
            }
            DocumentNode::CodeBlock { code, .. } => {
                let _ = writeln!(out, "{}[{}]{} CODE: {}", indent, path, anchor, code);
            }
            DocumentNode::Image { alt, .. } => {
                let _ = writeln!(out, "{}[{}]{} IMG: {}", indent, path, anchor, alt);
            }
            _ => {
                let _ = writeln!(out, "{}[{}]{} {:?}", indent, path, anchor, node.kind());
            }
        }

        for child in self.children(id) {
            self.debug_node(child, depth + 1, out);
        }
    }
}

impl Default for DocumentTree {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for DocumentTree {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.debug_tree())
    }
}

impl AsRef<Arena<DocumentNode>> for DocumentTree {
    fn as_ref(&self) -> &Arena<DocumentNode> {
        &self.arena
    }
}

impl Index<NodeId> for DocumentTree {
    type Output = DocumentNode;

    fn index(&self, id: NodeId) -> &Self::Output {
        self.arena[id.into_raw()].get()
    }
}

impl<'a> IntoIterator for &'a DocumentTree {
    type Item = NodeId;
    type IntoIter = DescendantsIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        DescendantsIter(self.root.descendants(&self.arena))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify() {
        assert_eq!(DocumentNode::slugify("Hello World"), "hello-world");
        assert_eq!(DocumentNode::slugify("Section 1.2.3"), "section-1-2-3");
        assert_eq!(DocumentNode::slugify("  Trim  Me  "), "trim-me");
        assert_eq!(DocumentNode::slugify("UPPERCASE"), "uppercase");
        assert_eq!(DocumentNode::slugify("TÍTULO PRELIMINAR"), "título-preliminar");
        assert_eq!(DocumentNode::slugify_ascii("TÍTULO PRELIMINAR"), "titulo-preliminar");
    }

    #[test]
    fn section_creation() {
        let sec = DocumentNode::section(2, "Getting Started");
        assert!(sec.is_section());
        assert_eq!(sec.section_level(), Some(2));
        assert_eq!(sec.anchor(), Some("getting-started"));
        assert_eq!(sec.section_title(), Some("Getting Started"));
    }

    #[test]
    fn tree_construction() {
        let mut tree = DocumentTree::new();
        let root = tree.root();

        let sec1 = tree.add_child(root, DocumentNode::section(1, "Introduction"));
        let sec2 = tree.add_child(root, DocumentNode::section(1, "Methods"));
        let sub = tree.add_child(sec2, DocumentNode::section(2, "Participants"));

        assert_eq!(tree.path(sec1).to_string(), "1");
        assert_eq!(tree.path(sec2).to_string(), "2");
        assert_eq!(tree.path(sub).to_string(), "2.1");
    }

    #[test]
    fn anchor_lookup() {
        let mut tree = DocumentTree::new();
        tree.add_child(tree.root(), DocumentNode::section(1, "Introduction"));
        tree.add_child(tree.root(), DocumentNode::section(1, "Results"));
        tree.add_child(tree.root(), DocumentNode::section(1, "TÍTULO PRELIMINAR"));

        assert!(tree.find_by_anchor("introduction").is_some());
        assert!(tree.find_by_anchor("results").is_some());
        assert!(tree.find_by_anchor("título-preliminar").is_some());
        assert!(tree.find_by_anchor("titulo-preliminar").is_some());
        assert!(tree.find_by_anchor("nonexistent").is_none());
    }

    #[test]
    fn path_navigation() {
        let mut tree = DocumentTree::new();
        let sec1 = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
        let sec2 = tree.add_child(sec1, DocumentNode::section(2, "B"));

        assert_eq!(tree.find_by_path(&"1".parse().unwrap()).unwrap(), sec1);
        assert_eq!(tree.find_by_path(&"1.1".parse().unwrap()).unwrap(), sec2);

        let err = tree.find_by_path(&"1.2".parse().unwrap()).unwrap_err();
        assert!(err.to_string().contains("out of bounds"));

        let err = "invalid".parse::<SectionPath>().unwrap_err();
        assert!(err.to_string().contains("not a number"));
    }

    #[test]
    fn parent_section() {
        let mut tree = DocumentTree::new();
        let sec = tree.add_child(tree.root(), DocumentNode::section(1, "Parent"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        let text = tree.add_child(para, DocumentNode::text("text"));

        assert_eq!(tree.parent_section(text), Some(sec));
        assert!(tree.parent_section(sec).is_none());
    }

    #[test]
    fn sections_are_preordered() {
        let mut tree = DocumentTree::new();
        tree.add_child(tree.root(), DocumentNode::section(1, "First"));
        let sec = tree.add_child(tree.root(), DocumentNode::section(1, "Second"));
        tree.add_child(sec, DocumentNode::section(2, "Nested"));

        let sections = tree.sections().collect::<Vec<_>>();
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].anchor, "first");
        assert_eq!(sections[1].anchor, "second");
        assert_eq!(sections[2].anchor, "nested");
        assert_eq!(sections[2].path.to_string(), "2.1");
    }

    #[test]
    fn path_ignores_non_section_siblings() {
        let mut tree = DocumentTree::new();
        let a = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
        let para = tree.add_child(a, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("x"));
        tree.add_child(a, DocumentNode::html("<table><tr><td>x</td></tr></table>"));
        let b = tree.add_child(a, DocumentNode::section(2, "B"));

        assert_eq!(tree.path(b).to_string(), "1.1");
        assert_eq!(tree.find_by_path(&"1.1".parse().unwrap()).unwrap(), b);
    }

    #[test]
    fn update_keeps_anchor_index_in_sync() {
        let mut tree = DocumentTree::new();
        let id = tree.add_child(tree.root(), DocumentNode::section(1, "Old"));

        let _ = tree.update(id, |node| {
            *node = DocumentNode::section(1, "New");
        });

        assert!(tree.find_by_anchor("old").is_none());
        assert_eq!(tree.find_by_anchor("new"), Some(id));
    }

    #[test]
    fn set_anchor_rejects_unanchorable_nodes() {
        let mut tree = DocumentTree::new();
        let id = tree.add_child(tree.root(), DocumentNode::paragraph());
        assert!(!tree.set_anchor(id, Some("x".to_string())));
    }
}
