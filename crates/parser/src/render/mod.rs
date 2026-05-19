pub mod markdown;
pub mod writer;

use writer::{NodeContext, TreeWriter};

use crate::NodeId;
use crate::tree::{DocumentNode, DocumentTree};

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

    let last = tree.arena().get(id.into_raw()).and_then(|node| node.next_sibling()).is_none();
    let ctx = NodeContext { depth, anchor: node.anchor(), path: tree.path(id), last };

    match node {
        DocumentNode::Root => kids(tree, id, depth, w)?,
        DocumentNode::Section { level, kind, title, .. } => {
            w.enter_section(*level, *kind, title, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_section(*level, *kind, title, &ctx)?;
        }
        DocumentNode::Paragraph => {
            w.enter_paragraph(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_paragraph(&ctx)?;
        }
        DocumentNode::Html(html) => {
            w.write_html(html, &ctx)?;
        }
        DocumentNode::List { style, spacing } => {
            w.enter_list(*style, *spacing, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_list(*style, *spacing, &ctx)?;
        }
        DocumentNode::ListItem => {
            w.enter_list_item(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_list_item(&ctx)?;
        }
        DocumentNode::CodeBlock { language, code } => {
            w.write_code_block(language.as_deref(), code, &ctx)?;
        }
        DocumentNode::BlockQuote => {
            w.enter_blockquote(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_blockquote(&ctx)?;
        }
        DocumentNode::Table { alignments } => {
            w.enter_table(alignments, &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_table(alignments, &ctx)?;
        }
        DocumentNode::TableRow => {
            w.enter_table_row(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_table_row(&ctx)?;
        }
        DocumentNode::TableCell => {
            w.enter_table_cell(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_table_cell(&ctx)?;
        }
        DocumentNode::Text(text) => {
            w.write_text(text, &ctx)?;
        }
        DocumentNode::Strong => {
            w.enter_strong(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_strong(&ctx)?;
        }
        DocumentNode::Emphasis => {
            w.enter_emphasis(&ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_emphasis(&ctx)?;
        }
        DocumentNode::Link { url, title } => {
            w.enter_link(url, title.as_deref(), &ctx)?;
            kids(tree, id, depth + 1, w)?;
            w.leave_link(url, title.as_deref(), &ctx)?;
        }
        DocumentNode::Image { url, alt, .. } => {
            w.write_image(url, alt, &ctx)?;
        }
        DocumentNode::ThematicBreak => {
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
