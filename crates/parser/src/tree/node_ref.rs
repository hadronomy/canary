use std::fmt;
use std::iter::FusedIterator;

use super::{
    DocumentNode, DocumentTree, HeadingLevel, LinkTarget, NodeKind, NodeView, SectionKind,
    SectionPath,
};
use crate::NodeId;

#[derive(Clone, Copy)]
pub struct NodeRef<'a> {
    pub(super) tree: &'a DocumentTree,
    pub(super) id: NodeId,
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
    pub fn section_level(self) -> Option<HeadingLevel> {
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
    #[inline]
    pub fn view(self) -> NodeView<'a> {
        self.data().view()
    }

    #[must_use]
    pub fn path(self) -> SectionPath {
        self.tree.path_of(self.id)
    }

    #[must_use]
    pub fn is_last_sibling(self) -> bool {
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
    pub fn text_content(self) -> String {
        self.tree.extract_text(self.id)
    }

    #[must_use]
    pub fn text(self) -> String {
        self.text_content()
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
            pub(super) tree: &'a DocumentTree,
            pub(super) inner: $inner,
        }

        impl<'a> Iterator for $name<'a> {
            type Item = NodeRef<'a>;

            fn next(&mut self) -> Option<Self::Item> {
                self.inner.next().map(|raw| NodeRef { tree: self.tree, id: NodeId::from_raw(raw) })
            }

            fn size_hint(&self) -> (usize, Option<usize>) {
                self.inner.size_hint()
            }
        }

        impl FusedIterator for $name<'_> {}
    };
}

node_iter!(DescendantsIter, indextree::Descendants<'a, DocumentNode>);
node_iter!(AncestorsIter, indextree::Ancestors<'a, DocumentNode>);
node_iter!(ChildrenIter, indextree::Children<'a, DocumentNode>);
