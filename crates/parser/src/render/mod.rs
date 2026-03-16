pub mod markdown;
pub mod writer;

use crate::NodeId;
use crate::tree::{DocumentTree, NodeKind};
use writer::{NodeContext, TreeWriter};

pub fn render<W: TreeWriter>(tree: &DocumentTree, root: NodeId, w: &mut W) -> Result<(), W::Error> {
    walk(tree, root, 0, w)
}

fn walk<W: TreeWriter>(
    tree: &DocumentTree,
    id: NodeId,
    depth: usize,
    w: &mut W,
) -> Result<(), W::Error> {
    let Some(node) = tree.get(id) else {
        return Ok(());
    };

    let last = tree
        .arena()
        .get(id.into_raw())
        .and_then(|n| n.next_sibling())
        .is_none();

    let ctx = NodeContext {
        depth,
        anchor: node.anchor.as_deref(),
        content: &node.content,
        path: tree.hierarchical_path(id),
        last,
    };

    match &node.kind {
        NodeKind::Root => {
            kids(tree, id, depth, w)?;
        }
        NodeKind::Section { level } => {
            w.enter_section(*level, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_section(*level, &ctx)?;
        }
        NodeKind::Paragraph => {
            w.enter_paragraph(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_paragraph(&ctx)?;
        }
        NodeKind::BlockQuote => {
            w.enter_blockquote(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_blockquote(&ctx)?;
        }
        NodeKind::List { ordered, tight } => {
            w.enter_list(*ordered, *tight, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_list(*ordered, *tight, &ctx)?;
        }
        NodeKind::ListItem => {
            w.enter_list_item(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_list_item(&ctx)?;
        }
        NodeKind::Table { alignments } => {
            w.enter_table(alignments, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_table(alignments, &ctx)?;
        }
        NodeKind::TableRow => {
            w.enter_table_row(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_table_row(&ctx)?;
        }
        NodeKind::TableCell => {
            w.enter_table_cell(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_table_cell(&ctx)?;
        }
        NodeKind::CodeBlock { language } => {
            w.write_code_block(language.as_deref(), &ctx)?;
        }
        NodeKind::Text => {
            w.write_text(&ctx)?;
        }
        NodeKind::Strong => {
            w.enter_strong(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_strong(&ctx)?;
        }
        NodeKind::Emphasis => {
            w.enter_emphasis(&ctx)?;
            if !ctx.content.is_empty() {
                w.write_text(&ctx)?;
            }
            kids(tree, id, depth + 1, w)?;
            w.leave_emphasis(&ctx)?;
        }
        NodeKind::Link { url, title } => {
            w.write_link(url, title.as_deref(), &ctx)?;
        }
        NodeKind::Image { url, alt } => {
            w.write_image(url, alt, &ctx)?;
        }
        NodeKind::ThematicBreak => {
            w.write_thematic_break()?;
        }
    }

    Ok(())
}

fn kids<W: TreeWriter>(
    tree: &DocumentTree,
    parent: NodeId,
    depth: usize,
    w: &mut W,
) -> Result<(), W::Error> {
    for child in tree.children(parent) {
        walk(tree, child, depth, w)?;
    }
    Ok(())
}
