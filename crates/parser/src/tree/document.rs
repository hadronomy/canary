use std::collections::HashMap;
use std::fmt;
use std::fmt::Write;
use std::ops::Index;

use indextree::{Arena, NodeEdge};
use smallvec::SmallVec;

use super::path::SectionMeta;
use super::text::{default_span, span};
use super::{
    AncestorsIter, Anchor, Atom, ChildrenIter, DescendantsIter, DocumentNode, DocumentTreeBuilder,
    NodeRef, NodeSet, SectionEntry, SectionIndex, SectionPath, Tag, TagEnd, TextExtractOptions,
    TextSpans, Visit, VisitFlow,
};
use crate::NodeId;
use crate::error::{DocumentError, NodeLookupError, Result, TreeBuildError};

type Indexes = (Vec<Option<SectionMeta>>, Vec<Option<Box<[NodeId]>>>, Vec<NodeId>, Vec<NodeId>);

/// Hierarchical document tree with anchor and section-path navigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTree {
    pub(super) arena: Arena<DocumentNode>,
    pub(super) root: indextree::NodeId,
    pub(super) index: HashMap<Anchor, NodeSet>,
    pub(super) alias: HashMap<Anchor, NodeSet>,
    pub(super) primary_index: HashMap<Anchor, NodeId>,
    pub(super) primary_alias: HashMap<Anchor, NodeId>,
    pub(super) refs: HashMap<Anchor, NodeSet>,
    pub(super) section_meta: Vec<Option<SectionMeta>>,
    pub(super) section_children: Vec<Option<Box<[NodeId]>>>,
    pub(super) section_order: Vec<NodeId>,
    pub(super) figures: Vec<NodeId>,
}

impl DocumentTree {
    fn lookup_primary(&self, key: &str) -> Option<NodeId> {
        self.primary_index.get(key).copied().or_else(|| self.primary_alias.get(key).copied())
    }

    #[must_use]
    pub fn builder() -> DocumentTreeBuilder {
        DocumentTreeBuilder::new()
    }

    #[inline]
    pub fn root(&self) -> NodeId {
        NodeId::from_raw(self.root)
    }

    pub fn root_node(&self) -> NodeRef<'_> {
        NodeRef { tree: self, id: self.root() }
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

    pub fn try_node(&self, id: NodeId) -> std::result::Result<NodeRef<'_>, NodeLookupError> {
        self.node(id).ok_or(NodeLookupError::UnknownNode { id })
    }

    #[must_use]
    pub fn find_by_anchor(&self, query: &str) -> Option<NodeId> {
        if let Some(id) = self.lookup_primary(query) {
            return Some(id);
        }

        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        if let Some(id) = self.lookup_primary(query) {
            return Some(id);
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query
            && let Some(id) = self.lookup_primary(slug.as_str())
        {
            return Some(id);
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query && ascii != slug {
            return self.lookup_primary(ascii.as_str());
        }

        None
    }

    pub fn find_all_by_anchor(&self, query: &str) -> impl Iterator<Item = NodeId> {
        self.lookup_anchor_ids(query).into_iter()
    }

    pub fn references_to(&self, query: &str) -> impl Iterator<Item = NodeId> + '_ {
        self.lookup_refs(query).iter().copied()
    }

    #[must_use]
    pub fn find_references_to(&self, query: &str) -> Vec<NodeId> {
        self.references_to(query).collect()
    }

    pub fn anchor_of(&self, id: NodeId) -> Option<&Anchor> {
        self.get(id).and_then(DocumentNode::anchor_value)
    }

    pub fn get_anchor(&self, id: NodeId) -> Option<&str> {
        self.anchor_of(id).map(Anchor::as_str)
    }

    pub(super) fn build_indexes(
        arena: &Arena<DocumentNode>,
        root: indextree::NodeId,
    ) -> std::result::Result<Indexes, TreeBuildError> {
        fn slot(id: NodeId) -> usize {
            usize::from(id.into_raw())
        }

        let mut path = SmallVec::<[SectionIndex; 6]>::new();
        let mut section_meta = vec![None; arena.capacity() + 1];
        let mut section_children = vec![Vec::new(); arena.capacity() + 1];
        let mut section_order = Vec::with_capacity(arena.count() / 4);
        let mut figures = Vec::new();
        let root = NodeId::from_raw(root);
        let mut stack = SmallVec::<[NodeId; 8]>::new();
        stack.push(root);

        for edge in root.into_raw().traverse(arena) {
            match edge {
                NodeEdge::Start(raw) => {
                    let id = NodeId::from_raw(raw);
                    let node = arena[raw].get();
                    if matches!(node, DocumentNode::Image(_)) {
                        figures.push(id);
                    }
                    if !node.is_section() {
                        continue;
                    }

                    let parent = *stack.last().expect("section traversal stack always has root");
                    let idx = section_children[slot(parent)].len() + 1;
                    let part = SectionIndex::from_usize(idx)
                        .ok_or(TreeBuildError::TooManySectionSiblings { parent, index: idx })?;
                    path.push(part);
                    section_meta[slot(id)] =
                        Some(SectionMeta { path: SectionPath::from_parts(path.as_slice()) });
                    section_children[slot(parent)].push(id);
                    section_order.push(id);
                    stack.push(id);
                }
                NodeEdge::End(raw) => {
                    if arena[raw].get().is_section() {
                        path.pop();
                        stack.pop();
                    }
                }
            }
        }
        Ok((
            section_meta,
            section_children
                .into_iter()
                .map(|kids| (!kids.is_empty()).then(|| kids.into_boxed_slice()))
                .collect(),
            section_order,
            figures,
        ))
    }

    pub(crate) fn figure(&self, idx: SectionIndex) -> Option<NodeId> {
        self.figures.get(idx.get().saturating_sub(1)).copied()
    }

    #[must_use]
    pub fn path(&self, id: NodeId) -> SectionPath {
        self.try_path(id).expect("NodeId must belong to this DocumentTree")
    }

    pub fn try_path(&self, id: NodeId) -> std::result::Result<SectionPath, NodeLookupError> {
        let _ = self.try_node(id)?;
        Ok(self.path_of(id))
    }

    pub(super) fn path_of(&self, id: NodeId) -> SectionPath {
        if let Some(meta) =
            self.section_meta.get(usize::from(id.into_raw())).and_then(Option::as_ref)
        {
            return meta.path.clone();
        }

        let mut raw = id.into_raw();
        while let Some(parent) = self.arena[raw].parent() {
            raw = parent;
            let id = NodeId::from_raw(raw);
            if let Some(meta) =
                self.section_meta.get(usize::from(id.into_raw())).and_then(Option::as_ref)
            {
                return meta.path.clone();
            }
        }
        SectionPath::root()
    }

    #[must_use]
    pub fn hierarchical_path(&self, id: NodeId) -> String {
        self.path_of(id).to_string()
    }

    pub fn try_hierarchical_path(
        &self,
        id: NodeId,
    ) -> std::result::Result<String, NodeLookupError> {
        self.try_path(id).map(|path| path.to_string())
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
                path: self
                    .section_meta
                    .get(usize::from(id.into_raw()))
                    .and_then(Option::as_ref)?
                    .path
                    .clone(),
                level,
            })
        })
    }

    pub fn find_by_path(&self, path: &SectionPath) -> Result<NodeId> {
        if path.is_root() {
            return Ok(self.root());
        }

        let mut id = self.root();
        for part in path.iter() {
            let idx = part.get().saturating_sub(1);
            let Some(child) = self
                .section_children
                .get(usize::from(id.into_raw()))
                .and_then(Option::as_deref)
                .and_then(|kids| kids.get(idx).copied())
            else {
                return Err(DocumentError::InvalidPath {
                    path: path.to_string(),
                    reason: "path is out of bounds".to_string(),
                });
            };
            id = child;
        }
        Ok(id)
    }

    pub fn parent_section(&self, id: NodeId) -> Option<NodeRef<'_>> {
        self.ancestors(id).skip(1).find(|node| node.data().is_section())
    }

    pub fn text_spans(&self, id: NodeId) -> TextSpans<'_> {
        self.text_spans_with(id, TextExtractOptions::default())
    }

    pub fn text_spans_with(&self, id: NodeId, opts: TextExtractOptions) -> TextSpans<'_> {
        TextSpans {
            inner: self.arena.get(id.into_raw()).map(|_| id.into_raw().descendants(&self.arena)),
            opts,
            tree: self,
        }
    }

    pub fn extract_text(&self, id: NodeId) -> String {
        self.extract_text_default(id)
    }

    pub fn extract_text_with(&self, id: NodeId, opts: TextExtractOptions) -> String {
        if opts == TextExtractOptions::default() {
            return self.extract_text_default(id);
        }
        self.extract_text_impl(id, opts.separator.as_str(), |node| {
            span(opts, node).map(|it| it.text)
        })
    }

    fn extract_text_default(&self, id: NodeId) -> String {
        self.extract_text_impl(id, TextExtractOptions::default().separator.as_str(), default_span)
    }

    fn extract_text_impl<'a, F>(&'a self, id: NodeId, sep: &str, pick: F) -> String
    where
        F: Fn(&'a DocumentNode) -> Option<&'a str>,
    {
        let Some(_) = self.arena.get(id.into_raw()) else {
            return String::new();
        };

        let mut spans = SmallVec::<[&str; 16]>::new();
        let mut len = 0usize;
        for raw in id.into_raw().descendants(&self.arena) {
            let Some(text) = pick(self.arena[raw].get()) else {
                continue;
            };
            len += text.len();
            spans.push(text);
        }
        if spans.is_empty() {
            return String::new();
        }

        let mut out =
            String::with_capacity(len + sep.len().saturating_mul(spans.len().saturating_sub(1)));
        for (idx, text) in spans.into_iter().enumerate() {
            if idx > 0 {
                out.push_str(sep);
            }
            out.push_str(text);
        }
        out
    }

    pub fn visit<V: Visit>(
        &self,
        root: NodeId,
        v: &mut V,
    ) -> std::result::Result<VisitFlow, V::Error> {
        let Some(node) = self.node(root) else {
            return Ok(VisitFlow::Continue);
        };
        v.visit_node(node)
    }

    pub fn debug_tree(&self) -> String {
        let mut out = String::new();
        let _ = self.visit(self.root(), &mut DebugTreeVisitor { out: &mut out, depth: 0 });
        out
    }

    fn lookup_anchor_ids(&self, query: &str) -> NodeSet {
        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        let lookup = |key: &str| {
            let mut ids = NodeSet::new();
            if let Some(found) = self.index.get(key) {
                ids.extend(found.iter().copied());
            }
            if let Some(found) = self.alias.get(key) {
                for id in found {
                    if !ids.contains(id) {
                        ids.push(*id);
                    }
                }
            }
            ids
        };
        let ids = lookup(query);
        if !ids.is_empty() {
            return ids;
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query {
            let ids = lookup(slug.as_str());
            if !ids.is_empty() {
                return ids;
            }
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query && ascii != slug {
            let ids = lookup(ascii.as_str());
            if !ids.is_empty() {
                return ids;
            }
        }

        NodeSet::new()
    }

    fn lookup_refs(&self, query: &str) -> &[NodeId] {
        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        if let Some(ids) = self.refs.get(query) {
            return ids.as_slice();
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query
            && let Some(ids) = self.refs.get(slug.as_str())
        {
            return ids.as_slice();
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query
            && ascii != slug
            && let Some(ids) = self.refs.get(ascii.as_str())
        {
            return ids.as_slice();
        }

        &[]
    }
}

struct DebugTreeVisitor<'a> {
    out: &'a mut String,
    depth: usize,
}

impl Visit for DebugTreeVisitor<'_> {
    type Error = fmt::Error;

    fn enter_tag(
        &mut self,
        node: NodeRef<'_>,
        tag: Tag<'_>,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        let text = match tag {
            Tag::Root => "ROOT".to_string(),
            Tag::Section(section) => format!("H{}: {}", section.level(), section.title()),
            _ => format!("{:?}", tag.kind()),
        };
        let indent = "  ".repeat(self.depth);
        let path = node.path();
        let anchor = node.anchor().map(|it| format!("[#{it}]")).unwrap_or_default();
        writeln!(self.out, "{}[{}]{} {}", indent, path, anchor, text)?;
        self.depth += 1;
        Ok(VisitFlow::Continue)
    }

    fn leave_tag(
        &mut self,
        _node: NodeRef<'_>,
        _tag: TagEnd,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        self.depth = self.depth.saturating_sub(1);
        Ok(VisitFlow::Continue)
    }

    fn visit_atom(
        &mut self,
        node: NodeRef<'_>,
        atom: Atom<'_>,
    ) -> std::result::Result<VisitFlow, Self::Error> {
        let text = match atom {
            Atom::Text(text) => format!("TEXT: {}", text.text()),
            Atom::Html(html) => format!("HTML: {}", html.html()),
            Atom::CodeBlock(code) => format!("CODE: {}", code.code()),
            Atom::Image(image) => format!("IMG: {}", image.alt()),
            _ => format!("{:?}", atom.kind()),
        };
        let indent = "  ".repeat(self.depth);
        let path = node.path();
        let anchor = node.anchor().map(|it| format!("[#{it}]")).unwrap_or_default();
        writeln!(self.out, "{}[{}]{} {}", indent, path, anchor, text)?;
        Ok(VisitFlow::Continue)
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
