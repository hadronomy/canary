pub mod markdown;
pub mod writer;

use writer::{RenderEvent, TreeWriter};

use crate::NodeId;
use crate::tree::{DocumentTree, NodeView, Tag};

pub fn render<W: TreeWriter>(tree: &DocumentTree, root: NodeId, w: &mut W) -> Result<(), W::Error> {
    walk(tree, root, w)
}

fn walk<W: TreeWriter>(tree: &DocumentTree, id: NodeId, w: &mut W) -> Result<(), W::Error> {
    let Some(node) = tree.node(id) else {
        return Ok(());
    };

    match node.view() {
        NodeView::Tag(Tag::Root) => kids(tree, id, w)?,
        NodeView::Tag(tag) => w.with(tag, |w| kids(tree, id, w))?,
        NodeView::Atom(atom) => w.event(RenderEvent::Atom(atom))?,
    }

    Ok(())
}

fn kids<W: TreeWriter>(tree: &DocumentTree, parent: NodeId, w: &mut W) -> Result<(), W::Error> {
    for child in tree.children(parent) {
        walk(tree, child.id(), w)?;
    }
    Ok(())
}
