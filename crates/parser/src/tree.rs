//! Core tree data structures and navigation.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::fmt;
use std::fmt::Write;
use std::num::NonZeroU16;
use std::ops::Index;
use std::str::FromStr;

use deunicode::deunicode;
use indextree::Arena;
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;
use smol_str::SmolStr;
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

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct Anchor(SmolStr);

impl Anchor {
    #[must_use]
    pub fn new(value: impl Into<SmolStr>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn slug(text: &str) -> Self {
        Self(SmolStr::from(DocumentNode::slugify(text)))
    }

    #[must_use]
    pub fn ascii_slug(text: &str) -> Self {
        Self(SmolStr::from(DocumentNode::slugify_ascii(text)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for Anchor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for Anchor {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for Anchor {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl From<&str> for Anchor {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for Anchor {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<SmolStr> for Anchor {
    fn from(value: SmolStr) -> Self {
        Self::new(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct BlockId(SmolStr);

impl BlockId {
    #[must_use]
    pub fn new(value: impl AsRef<str>) -> Option<Self> {
        let value = value.as_ref().trim();
        (!value.is_empty()).then(|| Self(SmolStr::from(value)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Display for BlockId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for BlockId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(transparent)]
pub struct SectionIndex(NonZeroU16);

impl SectionIndex {
    #[must_use]
    pub fn new(value: u16) -> Option<Self> {
        NonZeroU16::new(value).map(Self)
    }

    #[must_use]
    pub fn from_usize(value: usize) -> Option<Self> {
        u16::try_from(value).ok().and_then(Self::new)
    }

    #[must_use]
    pub fn get(self) -> usize {
        self.0.get() as usize
    }
}

impl fmt::Display for SectionIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.get())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkTarget {
    Anchor(Anchor),
    Reference(SmolStr),
    External(SmolStr),
}

impl LinkTarget {
    #[must_use]
    pub fn anchor(value: impl Into<Anchor>) -> Self {
        Self::Anchor(value.into())
    }

    #[must_use]
    pub fn reference(value: impl Into<String>) -> Self {
        Self::Reference(SmolStr::from(value.into()))
    }

    #[must_use]
    pub fn external(value: impl Into<String>) -> Self {
        Self::External(SmolStr::from(value.into()))
    }

    #[must_use]
    pub fn parse(value: impl AsRef<str>) -> Self {
        let value = value.as_ref().trim();
        if let Some(value) = value.strip_prefix('#') {
            return Self::anchor(Anchor::from(value.to_string()));
        }
        if value.contains("://")
            || value.starts_with("mailto:")
            || value.starts_with("tel:")
            || value.starts_with('/')
        {
            return Self::external(value.to_string());
        }
        Self::reference(value.to_string())
    }

    #[must_use]
    pub fn key(&self) -> &str {
        match self {
            Self::Anchor(anchor) => anchor.as_str(),
            Self::Reference(value) | Self::External(value) => value.as_str(),
        }
    }

    #[must_use]
    pub fn anchor_ref(&self) -> Option<&Anchor> {
        match self {
            Self::Anchor(anchor) => Some(anchor),
            Self::Reference(_) | Self::External(_) => None,
        }
    }
}

impl fmt::Display for LinkTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Anchor(anchor) => write!(f, "#{}", anchor.as_str()),
            Self::Reference(value) | Self::External(value) => f.write_str(value),
        }
    }
}

impl From<&str> for LinkTarget {
    fn from(value: &str) -> Self {
        Self::parse(value)
    }
}

impl From<String> for LinkTarget {
    fn from(value: String) -> Self {
        Self::parse(value)
    }
}

/// A typed document node.
///
/// Block containers no longer carry generic text payloads. Text lives in `Text`
/// leaves, and inline structure is preserved by child order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocumentNode {
    Root,
    Section { level: u8, kind: SectionKind, anchor: Anchor, title: String },
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
    Link { target: LinkTarget, title: Option<String> },
    Image { anchor: Option<Anchor>, url: SmolStr, alt: String },
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
    pub fn link(target: impl Into<LinkTarget>, title: Option<String>) -> Self {
        Self::Link { target: target.into(), title }
    }

    #[must_use]
    pub fn link_anchor(anchor: impl Into<Anchor>, title: Option<String>) -> Self {
        Self::Link { target: LinkTarget::anchor(anchor), title }
    }

    #[must_use]
    pub fn link_reference(value: impl Into<String>, title: Option<String>) -> Self {
        Self::Link { target: LinkTarget::reference(value), title }
    }

    #[must_use]
    pub fn link_external(url: impl Into<String>, title: Option<String>) -> Self {
        Self::Link { target: LinkTarget::external(url), title }
    }

    #[must_use]
    pub fn image(url: impl Into<String>, alt: impl Into<String>) -> Self {
        Self::Image { anchor: None, url: SmolStr::from(url.into()), alt: alt.into() }
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
        Self::Section { level, kind, anchor: Anchor::slug(title), title: title.to_string() }
    }

    #[must_use]
    pub fn with_anchor(mut self, anchor: impl Into<Anchor>) -> Self {
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

    #[must_use]
    pub fn anchor(&self) -> Option<&str> {
        self.anchor_value().map(Anchor::as_str)
    }

    #[must_use]
    pub fn anchor_value(&self) -> Option<&Anchor> {
        match self {
            Self::Section { anchor, .. } => Some(anchor),
            Self::Image { anchor, .. } => anchor.as_ref(),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_title(&self) -> Option<&str> {
        match self {
            Self::Section { title, .. } => Some(title.as_str()),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_level(&self) -> Option<u8> {
        match self {
            Self::Section { level, .. } => Some(*level),
            _ => None,
        }
    }

    #[must_use]
    pub fn section_kind(&self) -> Option<SectionKind> {
        match self {
            Self::Section { kind, .. } => Some(*kind),
            _ => None,
        }
    }

    #[must_use]
    pub fn link_target(&self) -> Option<&LinkTarget> {
        match self {
            Self::Link { target, .. } => Some(target),
            _ => None,
        }
    }

    #[must_use]
    pub fn image_url(&self) -> Option<&str> {
        match self {
            Self::Image { url, .. } => Some(url.as_str()),
            _ => None,
        }
    }

    #[must_use]
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

    fn reference_target(&self) -> Option<&Anchor> {
        self.link_target().and_then(LinkTarget::anchor_ref)
    }

    fn set_anchor(&mut self, anchor: Option<Anchor>) -> bool {
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
pub struct SectionPath(SmallVec<[SectionIndex; 6]>);

impl SectionPath {
    #[must_use]
    pub fn root() -> Self {
        Self(SmallVec::new())
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
    pub fn iter(&self) -> impl ExactSizeIterator<Item = SectionIndex> + Clone + '_ {
        self.0.iter().copied()
    }

    #[must_use]
    pub fn segments(&self) -> impl ExactSizeIterator<Item = usize> + Clone + '_ {
        self.iter().map(SectionIndex::get)
    }

    #[must_use]
    pub fn parent(&self) -> Option<Self> {
        (!self.is_root()).then(|| Self(self.0[..self.0.len() - 1].iter().copied().collect()))
    }

    #[must_use]
    pub fn join(&self, part: SectionIndex) -> Self {
        let mut out = self.0.clone();
        out.push(part);
        Self(out)
    }

    #[must_use]
    pub fn is_descendant_of(&self, other: &Self) -> bool {
        self.0.starts_with(&other.0)
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

        let mut out = SmallVec::<[SectionIndex; 6]>::new();
        for part in path.split('.') {
            let value = part.parse::<u16>().map_err(|_| DocumentError::InvalidPath {
                path: path.to_string(),
                reason: format!("`{part}` is not a number"),
            })?;
            let idx = SectionIndex::new(value).ok_or_else(|| DocumentError::InvalidPath {
                path: path.to_string(),
                reason: "path indices are 1-based".to_string(),
            })?;
            out.push(idx);
        }
        Ok(Self(out))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionEntry {
    pub id: NodeId,
    pub anchor: Anchor,
    pub path: SectionPath,
    pub level: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SectionMeta {
    path: SectionPath,
}

#[derive(Clone, Copy)]
pub struct NodeRef<'a> {
    tree: &'a DocumentTree,
    id: NodeId,
}

impl<'a> NodeRef<'a> {
    #[must_use]
    pub fn id(self) -> NodeId {
        self.id
    }

    #[must_use]
    pub fn data(self) -> &'a DocumentNode {
        &self.tree[self.id]
    }

    #[must_use]
    pub fn kind(self) -> NodeKind {
        self.data().kind()
    }

    #[must_use]
    pub fn anchor(self) -> Option<&'a str> {
        self.data().anchor()
    }

    #[must_use]
    pub fn section_title(self) -> Option<&'a str> {
        self.data().section_title()
    }

    #[must_use]
    pub fn section_level(self) -> Option<u8> {
        self.data().section_level()
    }

    #[must_use]
    pub fn section_kind(self) -> Option<SectionKind> {
        self.data().section_kind()
    }

    #[must_use]
    pub fn link_target(self) -> Option<&'a LinkTarget> {
        self.data().link_target()
    }

    #[must_use]
    pub fn image_url(self) -> Option<&'a str> {
        self.data().image_url()
    }

    #[must_use]
    pub fn display_text(self) -> Option<&'a str> {
        self.data().display_text()
    }

    #[must_use]
    pub fn path(self) -> SectionPath {
        self.tree.path(self.id)
    }

    #[must_use]
    pub fn last(self) -> bool {
        self.tree.arena().get(self.id.into_raw()).and_then(|node| node.next_sibling()).is_none()
    }

    pub fn children(self) -> ChildrenIter<'a> {
        self.tree.children(self.id)
    }

    pub fn descendants(self) -> DescendantsIter<'a> {
        self.tree.descendants(self.id)
    }

    pub fn ancestors(self) -> AncestorsIter<'a> {
        self.tree.ancestors(self.id)
    }

    #[must_use]
    pub fn parent_section(self) -> Option<Self> {
        self.tree.parent_section(self.id)
    }

    #[must_use]
    pub fn text(self) -> String {
        self.tree.extract_text(self.id)
    }
}

impl fmt::Debug for NodeRef<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NodeRef")
            .field("id", &self.id)
            .field("kind", &self.kind())
            .field("anchor", &self.anchor())
            .field("path", &self.path())
            .finish()
    }
}

macro_rules! node_iter {
    ($name:ident, $inner:ty) => {
        pub struct $name<'a> {
            tree: &'a DocumentTree,
            inner: $inner,
        }

        impl<'a> Iterator for $name<'a> {
            type Item = NodeRef<'a>;

            fn next(&mut self) -> Option<Self::Item> {
                self.inner.next().map(|raw| self.tree.node(NodeId::from_raw(raw)).unwrap())
            }
        }
    };
}

node_iter!(DescendantsIter, indextree::Descendants<'a, DocumentNode>);
node_iter!(AncestorsIter, indextree::Ancestors<'a, DocumentNode>);
node_iter!(ChildrenIter, indextree::Children<'a, DocumentNode>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTreeBuilder {
    arena: Arena<DocumentNode>,
    root: indextree::NodeId,
    index: HashMap<Anchor, indextree::NodeId>,
    alias: HashMap<Anchor, indextree::NodeId>,
    refs: HashMap<Anchor, Vec<NodeId>>,
}

impl DocumentTreeBuilder {
    #[must_use]
    pub fn new() -> Self {
        let mut arena = Arena::new();
        let root = arena.new_node(DocumentNode::root());
        Self { arena, root, index: HashMap::new(), alias: HashMap::new(), refs: HashMap::new() }
    }

    #[inline]
    pub fn root(&self) -> NodeId {
        NodeId::from_raw(self.root)
    }

    #[inline]
    pub fn node_count(&self) -> usize {
        self.arena.count()
    }

    pub fn get(&self, id: NodeId) -> Option<&DocumentNode> {
        self.arena.get(id.into_raw()).map(|node| node.get())
    }

    pub fn add_child(&mut self, parent: NodeId, node: DocumentNode) -> NodeId {
        let parent = parent.into_raw();
        let anchor = node.anchor_value().cloned();
        let target = node.reference_target().cloned();
        let raw = self.arena.new_node(node);
        parent.append(raw, &mut self.arena);
        let id = NodeId::from_raw(raw);
        if let Some(anchor) = anchor {
            self.put_anchor(raw, anchor);
        }
        if let Some(target) = target {
            self.put_ref(id, target);
        }
        id
    }

    #[must_use]
    pub fn set_anchor(&mut self, id: NodeId, anchor: Option<Anchor>) -> bool {
        let raw = id.into_raw();
        let (old, new) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return false;
            };
            let old = node.anchor_value().cloned();
            if !node.set_anchor(anchor) {
                return false;
            }
            let new = node.anchor_value().cloned();
            (old, new)
        };

        if old == new {
            return true;
        }
        if let Some(old) = old {
            self.drop_anchor(raw, &old);
        }
        if let Some(new) = new {
            self.put_anchor(raw, new);
        }
        true
    }

    #[must_use]
    pub fn update<F>(&mut self, id: NodeId, f: F) -> bool
    where
        F: FnOnce(&mut DocumentNode),
    {
        let raw = id.into_raw();
        let (old_anchor, new_anchor, old_ref, new_ref) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return false;
            };
            let old_anchor = node.anchor_value().cloned();
            let old_ref = node.reference_target().cloned();
            f(node);
            let new_anchor = node.anchor_value().cloned();
            let new_ref = node.reference_target().cloned();
            (old_anchor, new_anchor, old_ref, new_ref)
        };

        if old_anchor != new_anchor {
            if let Some(old) = old_anchor {
                self.drop_anchor(raw, &old);
            }
            if let Some(new) = new_anchor {
                self.put_anchor(raw, new);
            }
        }

        if old_ref != new_ref {
            if let Some(old) = old_ref {
                self.drop_ref(id, &old);
            }
            if let Some(new) = new_ref {
                self.put_ref(id, new);
            }
        }

        true
    }

    #[must_use]
    pub fn freeze(self) -> DocumentTree {
        let (section_meta, section_index, section_order, figures) =
            DocumentTree::build_indexes(&self.arena, self.root);
        DocumentTree {
            arena: self.arena,
            root: self.root,
            index: self.index,
            alias: self.alias,
            refs: self.refs,
            section_meta,
            section_index,
            section_order,
            figures,
        }
    }

    fn put_anchor(&mut self, id: indextree::NodeId, anchor: Anchor) {
        self.index.entry(anchor.clone()).or_insert(id);
        let alias = Anchor::ascii_slug(anchor.as_str());
        if alias != anchor {
            self.alias.entry(alias).or_insert(id);
        }
    }

    fn drop_anchor(&mut self, id: indextree::NodeId, anchor: &Anchor) {
        if self.index.get(anchor) == Some(&id) {
            self.index.remove(anchor);
        }
        let alias = Anchor::ascii_slug(anchor.as_str());
        if self.alias.get(&alias) == Some(&id) {
            self.alias.remove(&alias);
        }
    }

    fn put_ref(&mut self, id: NodeId, target: Anchor) {
        self.refs.entry(target).or_default().push(id);
    }

    fn drop_ref(&mut self, id: NodeId, target: &Anchor) {
        let empty = {
            let Some(ids) = self.refs.get_mut(target) else {
                return;
            };
            ids.retain(|it| *it != id);
            ids.is_empty()
        };
        if empty {
            self.refs.remove(target);
        }
    }
}

impl Default for DocumentTreeBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Hierarchical document tree with anchor and section-path navigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTree {
    arena: Arena<DocumentNode>,
    root: indextree::NodeId,
    index: HashMap<Anchor, indextree::NodeId>,
    alias: HashMap<Anchor, indextree::NodeId>,
    refs: HashMap<Anchor, Vec<NodeId>>,
    section_meta: HashMap<NodeId, SectionMeta>,
    section_index: HashMap<SectionPath, NodeId>,
    section_order: Vec<NodeId>,
    figures: Vec<NodeId>,
}

impl DocumentTree {
    #[must_use]
    pub fn builder() -> DocumentTreeBuilder {
        DocumentTreeBuilder::new()
    }

    #[inline]
    pub fn root(&self) -> NodeId {
        NodeId::from_raw(self.root)
    }

    pub fn root_node(&self) -> NodeRef<'_> {
        self.node(self.root()).unwrap()
    }

    pub fn arena(&self) -> &Arena<DocumentNode> {
        &self.arena
    }

    #[inline]
    pub fn node_count(&self) -> usize {
        self.arena.count()
    }

    pub fn get(&self, id: NodeId) -> Option<&DocumentNode> {
        self.arena.get(id.into_raw()).map(|node| node.get())
    }

    pub fn node(&self, id: NodeId) -> Option<NodeRef<'_>> {
        self.get(id).map(|_| NodeRef { tree: self, id })
    }

    #[must_use]
    pub fn find_by_anchor(&self, query: &str) -> Option<NodeId> {
        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        let lookup = |key: &str| self.index.get(key).or_else(|| self.alias.get(key)).copied();
        if let Some(id) = lookup(query) {
            return Some(NodeId::from_raw(id));
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query
            && let Some(id) = lookup(slug.as_str())
        {
            return Some(NodeId::from_raw(id));
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query && ascii != slug {
            return lookup(ascii.as_str()).map(NodeId::from_raw);
        }

        None
    }

    #[must_use]
    pub fn find_references_to(&self, query: &str) -> Vec<NodeId> {
        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        if let Some(ids) = self.refs.get(query) {
            return ids.clone();
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query
            && let Some(ids) = self.refs.get(slug.as_str())
        {
            return ids.clone();
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query && ascii != slug {
            return self.refs.get(ascii.as_str()).cloned().unwrap_or_default();
        }

        Vec::new()
    }

    pub fn get_anchor(&self, id: NodeId) -> Option<&str> {
        self.get(id).and_then(DocumentNode::anchor)
    }

    fn build_indexes(
        arena: &Arena<DocumentNode>,
        root: indextree::NodeId,
    ) -> (HashMap<NodeId, SectionMeta>, HashMap<SectionPath, NodeId>, Vec<NodeId>, Vec<NodeId>)
    {
        fn walk(
            arena: &Arena<DocumentNode>,
            raw: indextree::NodeId,
            path: &SectionPath,
            section_meta: &mut HashMap<NodeId, SectionMeta>,
            section_index: &mut HashMap<SectionPath, NodeId>,
            section_order: &mut Vec<NodeId>,
            figures: &mut Vec<NodeId>,
        ) {
            let id = NodeId::from_raw(raw);
            if matches!(arena[raw].get(), DocumentNode::Image { .. }) {
                figures.push(id);
            }

            let mut idx = 0usize;
            for child in raw.children(arena) {
                let child_path = if arena[child].get().is_section() {
                    idx += 1;
                    let child_id = NodeId::from_raw(child);
                    let child_path = path.join(
                        SectionIndex::from_usize(idx).expect("section indices always fit in u16"),
                    );
                    section_meta.insert(child_id, SectionMeta { path: child_path.clone() });
                    section_index.insert(child_path.clone(), child_id);
                    section_order.push(child_id);
                    child_path
                } else {
                    path.clone()
                };
                walk(
                    arena,
                    child,
                    &child_path,
                    section_meta,
                    section_index,
                    section_order,
                    figures,
                );
            }
        }

        let mut section_meta = HashMap::new();
        let mut section_index = HashMap::new();
        let mut section_order = Vec::new();
        let mut figures = Vec::new();
        walk(
            arena,
            root,
            &SectionPath::root(),
            &mut section_meta,
            &mut section_index,
            &mut section_order,
            &mut figures,
        );
        (section_meta, section_index, section_order, figures)
    }

    pub(crate) fn figure(&self, idx: SectionIndex) -> Option<NodeId> {
        self.figures.get(idx.get().saturating_sub(1)).copied()
    }

    #[must_use]
    pub fn path(&self, id: NodeId) -> SectionPath {
        if let Some(meta) = self.section_meta.get(&id) {
            return meta.path.clone();
        }

        let mut raw = id.into_raw();
        while let Some(parent) = self.arena[raw].parent() {
            raw = parent;
            let id = NodeId::from_raw(raw);
            if let Some(meta) = self.section_meta.get(&id) {
                return meta.path.clone();
            }
        }
        SectionPath::root()
    }

    #[must_use]
    pub fn hierarchical_path(&self, id: NodeId) -> String {
        self.path(id).to_string()
    }

    pub fn descendants(&self, node: NodeId) -> DescendantsIter<'_> {
        DescendantsIter { tree: self, inner: node.into_raw().descendants(&self.arena) }
    }

    pub fn ancestors(&self, node: NodeId) -> AncestorsIter<'_> {
        AncestorsIter { tree: self, inner: node.into_raw().ancestors(&self.arena) }
    }

    pub fn children(&self, node: NodeId) -> ChildrenIter<'_> {
        ChildrenIter { tree: self, inner: node.into_raw().children(&self.arena) }
    }

    pub fn sections(&self) -> impl Iterator<Item = SectionEntry> + '_ {
        self.section_order.iter().filter_map(|id| {
            let node = self.node(*id)?;
            let (Some(anchor), Some(level)) = (node.data().anchor_value(), node.section_level())
            else {
                return None;
            };
            Some(SectionEntry {
                id: *id,
                anchor: anchor.clone(),
                path: self.section_meta.get(id)?.path.clone(),
                level,
            })
        })
    }

    pub fn find_by_path(&self, path: &SectionPath) -> Result<NodeId> {
        if path.is_root() {
            return Ok(self.root());
        }

        self.section_index.get(path).copied().ok_or_else(|| DocumentError::InvalidPath {
            path: path.to_string(),
            reason: "path is out of bounds".to_string(),
        })
    }

    pub fn parent_section(&self, id: NodeId) -> Option<NodeRef<'_>> {
        self.ancestors(id).skip(1).find(|node| node.data().is_section())
    }

    pub fn extract_text(&self, id: NodeId) -> String {
        let mut out = String::new();
        for raw in id.into_raw().descendants(&self.arena) {
            let Some(text) = self.arena[raw].get().display_text().filter(|it| !it.is_empty())
            else {
                continue;
            };
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(text);
        }
        out
    }

    pub fn debug_tree(&self) -> String {
        let mut out = String::new();
        self.debug_node(self.root(), 0, &mut out);
        out
    }

    fn debug_node(&self, id: NodeId, depth: usize, out: &mut String) {
        let indent = "  ".repeat(depth);
        let Some(node) = self.node(id) else {
            return;
        };

        let path = node.path();
        let anchor = node.anchor().map(|it| format!("[#{it}]")).unwrap_or_default();

        match node.data() {
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

        for child in node.children() {
            self.debug_node(child.id(), depth + 1, out);
        }
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
    type Item = NodeRef<'a>;
    type IntoIter = DescendantsIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.descendants(self.root())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(f: impl FnOnce(&mut DocumentTreeBuilder)) -> DocumentTree {
        let mut tree = DocumentTree::builder();
        f(&mut tree);
        tree.freeze()
    }

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
        let tree = build(|tree| {
            let root = tree.root();
            let _ = tree.add_child(root, DocumentNode::section(1, "Introduction"));
            let sec2 = tree.add_child(root, DocumentNode::section(1, "Methods"));
            let _ = tree.add_child(sec2, DocumentNode::section(2, "Participants"));
        });

        let sections = tree.sections().collect::<Vec<_>>();
        assert_eq!(sections[0].path.to_string(), "1");
        assert_eq!(sections[1].path.to_string(), "2");
        assert_eq!(sections[2].path.to_string(), "2.1");
    }

    #[test]
    fn anchor_lookup() {
        let tree = build(|tree| {
            tree.add_child(tree.root(), DocumentNode::section(1, "Introduction"));
            tree.add_child(tree.root(), DocumentNode::section(1, "Results"));
            tree.add_child(tree.root(), DocumentNode::section(1, "TÍTULO PRELIMINAR"));
        });

        assert!(tree.find_by_anchor("introduction").is_some());
        assert!(tree.find_by_anchor("results").is_some());
        assert!(tree.find_by_anchor("título-preliminar").is_some());
        assert!(tree.find_by_anchor("titulo-preliminar").is_some());
        assert!(tree.find_by_anchor("nonexistent").is_none());
    }

    #[test]
    fn path_navigation() {
        let tree = build(|tree| {
            let sec1 = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
            let _ = tree.add_child(sec1, DocumentNode::section(2, "B"));
        });
        let sec1 = tree.find_by_anchor("a").unwrap();
        let sec2 = tree.find_by_anchor("b").unwrap();
        let path1 = tree.path(sec1);
        let path2 = tree.path(sec2);

        assert_eq!(tree.find_by_path(&path1).unwrap(), sec1);
        assert_eq!(tree.find_by_path(&path2).unwrap(), sec2);
        assert!(path2.is_descendant_of(&path1));
        assert!(!path1.is_descendant_of(&path2));
        assert_eq!(path2.parent().unwrap(), path1);

        let err = tree.find_by_path(&"1.2".parse().unwrap()).unwrap_err();
        assert!(err.to_string().contains("out of bounds"));

        let err = "invalid".parse::<SectionPath>().unwrap_err();
        assert!(err.to_string().contains("not a number"));
    }

    #[test]
    fn parent_section() {
        let tree = build(|tree| {
            let sec = tree.add_child(tree.root(), DocumentNode::section(1, "Parent"));
            let para = tree.add_child(sec, DocumentNode::paragraph());
            let _ = tree.add_child(para, DocumentNode::text("text"));
        });
        let sec = tree.find_by_anchor("parent").unwrap();
        let text = tree.descendants(sec).find(|node| node.display_text() == Some("text")).unwrap();

        assert_eq!(tree.parent_section(text.id()).map(NodeRef::id), Some(sec));
        assert!(tree.parent_section(sec).is_none());
    }

    #[test]
    fn sections_are_preordered() {
        let tree = build(|tree| {
            tree.add_child(tree.root(), DocumentNode::section(1, "First"));
            let sec = tree.add_child(tree.root(), DocumentNode::section(1, "Second"));
            tree.add_child(sec, DocumentNode::section(2, "Nested"));
        });

        let sections = tree.sections().collect::<Vec<_>>();
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].anchor.as_str(), "first");
        assert_eq!(sections[1].anchor.as_str(), "second");
        assert_eq!(sections[2].anchor.as_str(), "nested");
        assert_eq!(sections[2].path.to_string(), "2.1");
    }

    #[test]
    fn path_ignores_non_section_siblings() {
        let tree = build(|tree| {
            let a = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
            let para = tree.add_child(a, DocumentNode::paragraph());
            tree.add_child(para, DocumentNode::text("x"));
            tree.add_child(a, DocumentNode::html("<table><tr><td>x</td></tr></table>"));
            tree.add_child(a, DocumentNode::section(2, "B"));
        });
        let b = tree.find_by_anchor("b").unwrap();

        assert_eq!(tree.path(b).to_string(), "1.1");
        assert_eq!(tree.find_by_path(&"1.1".parse().unwrap()).unwrap(), b);
    }

    #[test]
    fn update_keeps_anchor_index_in_sync() {
        let mut tree = DocumentTree::builder();
        let id = tree.add_child(tree.root(), DocumentNode::section(1, "Old"));

        let _ = tree.update(id, |node| {
            *node = DocumentNode::section(1, "New");
        });

        let tree = tree.freeze();
        assert!(tree.find_by_anchor("old").is_none());
        assert_eq!(tree.find_by_anchor("new"), Some(id));
    }

    #[test]
    fn set_anchor_rejects_unanchorable_nodes() {
        let mut tree = DocumentTree::builder();
        let id = tree.add_child(tree.root(), DocumentNode::paragraph());
        assert!(!tree.set_anchor(id, Some(Anchor::from("x"))));
    }

    #[test]
    fn reference_index_tracks_anchor_links() {
        let mut tree = DocumentTree::builder();
        let sec = tree.add_child(tree.root(), DocumentNode::section(1, "A"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        let link = tree.add_child(para, DocumentNode::link_anchor("a", None));
        tree.add_child(link, DocumentNode::text("ref"));

        let _ = tree.update(link, |node| {
            *node = DocumentNode::link_anchor("b", None);
        });

        let tree = tree.freeze();
        assert!(tree.find_references_to("a").is_empty());
        assert_eq!(tree.find_references_to("b"), vec![link]);
    }
}
