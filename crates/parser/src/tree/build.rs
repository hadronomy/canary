use std::collections::HashMap;

use indextree::Arena;

use super::{Anchor, DocumentNode, DocumentTree, NodeSet};
use crate::NodeId;
use crate::error::{AnchorError, TreeBuildError, TreeMutationError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentTreeBuilder {
    arena: Arena<DocumentNode>,
    root: indextree::NodeId,
    index: HashMap<Anchor, NodeSet>,
    alias: HashMap<Anchor, NodeSet>,
    refs: HashMap<Anchor, NodeSet>,
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
        self.try_add_child(parent, node)
            .expect("parent NodeId must belong to this DocumentTreeBuilder")
    }

    pub fn try_add_child(
        &mut self,
        parent: NodeId,
        node: DocumentNode,
    ) -> std::result::Result<NodeId, TreeMutationError> {
        let parent = parent.into_raw();
        if self.arena.get(parent).is_none() {
            return Err(TreeMutationError::UnknownParent { parent: NodeId::from_raw(parent) });
        }
        let anchor = node.anchor_value().cloned();
        let target = node.reference_target().cloned();
        let raw = self.arena.new_node(node);
        let id = NodeId::from_raw(raw);
        parent.checked_append(raw, &mut self.arena).map_err(|source| {
            TreeMutationError::Structural { parent: NodeId::from_raw(parent), child: id, source }
        })?;
        if let Some(anchor) = anchor {
            self.put_anchor(id, anchor);
        }
        if let Some(target) = target {
            self.put_ref(id, target);
        }
        Ok(id)
    }

    pub fn set_anchor(
        &mut self,
        id: NodeId,
        anchor: Option<Anchor>,
    ) -> std::result::Result<(), TreeMutationError> {
        let raw = id.into_raw();
        let (old, new) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return Err(TreeMutationError::UnknownNode { id });
            };
            let old = node.anchor_value().cloned();
            node.try_set_anchor(anchor).map_err(|err| match err {
                AnchorError::NotAnchorable { kind } => {
                    TreeMutationError::NotAnchorable { id, kind }
                }
                AnchorError::RequiredAnchor => TreeMutationError::RequiredAnchor { id },
            })?;
            let new = node.anchor_value().cloned();
            (old, new)
        };

        if old == new {
            return Ok(());
        }
        if let Some(old) = old {
            self.drop_anchor(id, &old);
        }
        if let Some(new) = new {
            self.put_anchor(id, new);
        }
        Ok(())
    }

    pub fn update<F>(&mut self, id: NodeId, f: F) -> std::result::Result<(), TreeMutationError>
    where
        F: FnOnce(&mut DocumentNode),
    {
        let raw = id.into_raw();
        let (old_anchor, new_anchor, old_ref, new_ref) = {
            let Some(node) = self.arena.get_mut(raw).map(|node| node.get_mut()) else {
                return Err(TreeMutationError::UnknownNode { id });
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
                self.drop_anchor(id, &old);
            }
            if let Some(new) = new_anchor {
                self.put_anchor(id, new);
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

        Ok(())
    }

    pub fn freeze(self) -> DocumentTree {
        self.try_freeze().expect("document tree indexes should build successfully")
    }

    pub fn try_freeze(self) -> std::result::Result<DocumentTree, TreeBuildError> {
        let (section_meta, section_index, section_order, figures) =
            DocumentTree::build_indexes(&self.arena, self.root)?;
        Ok(DocumentTree {
            arena: self.arena,
            root: self.root,
            index: self.index,
            alias: self.alias,
            refs: self.refs,
            section_meta,
            section_index,
            section_order,
            figures,
        })
    }

    fn put_anchor(&mut self, id: NodeId, anchor: Anchor) {
        Self::push_id(self.index.entry(anchor.clone()).or_default(), id);
        let alias = Anchor::ascii_slug(anchor.as_str());
        if alias != anchor {
            Self::push_id(self.alias.entry(alias).or_default(), id);
        }
    }

    fn drop_anchor(&mut self, id: NodeId, anchor: &Anchor) {
        Self::drop_id(&mut self.index, anchor, id);
        let alias = Anchor::ascii_slug(anchor.as_str());
        Self::drop_id(&mut self.alias, &alias, id);
    }

    fn put_ref(&mut self, id: NodeId, target: Anchor) {
        Self::push_id(self.refs.entry(target).or_default(), id);
    }

    fn drop_ref(&mut self, id: NodeId, target: &Anchor) {
        Self::drop_id(&mut self.refs, target, id);
    }

    fn push_id(ids: &mut NodeSet, id: NodeId) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    fn drop_id(map: &mut HashMap<Anchor, NodeSet>, key: &Anchor, id: NodeId) {
        let empty = {
            let Some(ids) = map.get_mut(key) else {
                return;
            };
            ids.retain(|it| *it != id);
            ids.is_empty()
        };
        if empty {
            map.remove(key);
        }
    }
}

impl Default for DocumentTreeBuilder {
    fn default() -> Self {
        Self::new()
    }
}
