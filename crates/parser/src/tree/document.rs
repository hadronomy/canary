use std::collections::HashMap;
use std::fmt;
use std::fmt::Write;
use std::ops::Index;

use indextree::Arena;

use super::path::SectionMeta;
use super::{
    AncestorsIter, Anchor, Atom, ChildrenIter, DescendantsIter, DocumentNode, DocumentTreeBuilder,
    NodeRef, NodeSet, SectionEntry, SectionIndex, SectionPath, Tag, TagEnd, TextExtractOptions,
    TextSpans, Visit, VisitFlow,
};
use crate::NodeId;
use crate::error::{DocumentError, NodeLookupError, Result, TreeBuildError};

type Indexes =
    (HashMap<NodeId, SectionMeta>, HashMap<SectionPath, NodeId>, Vec<NodeId>, Vec<NodeId>);

/// Hierarchical document tree with anchor and section-path navigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTree {
    pub(super) arena: Arena<DocumentNode>,
    pub(super) root: indextree::NodeId,
    pub(super) index: HashMap<Anchor, NodeSet>,
    pub(super) alias: HashMap<Anchor, NodeSet>,
    pub(super) refs: HashMap<Anchor, NodeSet>,
    pub(super) section_meta: HashMap<NodeId, SectionMeta>,
    pub(super) section_index: HashMap<SectionPath, NodeId>,
    pub(super) section_order: Vec<NodeId>,
    pub(super) figures: Vec<NodeId>,
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
        let query = query.trim().strip_prefix('#').unwrap_or(query).trim();
        let lookup = |key: &str| {
            self.index
                .get(key)
                .and_then(|ids| ids.first().copied())
                .or_else(|| self.alias.get(key).and_then(|ids| ids.first().copied()))
        };
        if let Some(id) = lookup(query) {
            return Some(id);
        }

        let slug = Anchor::slug(query);
        if slug.as_str() != query
            && let Some(id) = lookup(slug.as_str())
        {
            return Some(id);
        }

        let ascii = Anchor::ascii_slug(query);
        if ascii.as_str() != query && ascii != slug {
            return lookup(ascii.as_str());
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
        fn walk(
            arena: &Arena<DocumentNode>,
            raw: indextree::NodeId,
            path: &SectionPath,
            section_meta: &mut HashMap<NodeId, SectionMeta>,
            section_index: &mut HashMap<SectionPath, NodeId>,
            section_order: &mut Vec<NodeId>,
            figures: &mut Vec<NodeId>,
        ) -> std::result::Result<(), TreeBuildError> {
            let id = NodeId::from_raw(raw);
            if matches!(arena[raw].get(), DocumentNode::Image(_)) {
                figures.push(id);
            }

            let mut idx = 0usize;
            for child in raw.children(arena) {
                let child_path = if arena[child].get().is_section() {
                    idx += 1;
                    let child_id = NodeId::from_raw(child);
                    let part = SectionIndex::from_usize(idx)
                        .ok_or(TreeBuildError::TooManySectionSiblings { parent: id, index: idx })?;
                    let child_path = path.join(part);
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
                )?;
            }
            Ok(())
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
        )?;
        Ok((section_meta, section_index, section_order, figures))
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
        self.extract_text_with(id, TextExtractOptions::default())
    }

    pub fn extract_text_with(&self, id: NodeId, opts: TextExtractOptions) -> String {
        let mut out = String::new();
        for span in self.text_spans_with(id, opts) {
            if !out.is_empty() {
                out.push_str(opts.separator.as_str());
            }
            out.push_str(span.text);
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
