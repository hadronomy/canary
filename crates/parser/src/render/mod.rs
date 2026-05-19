pub mod markdown;
pub mod writer;

use writer::TreeWriter;

use crate::NodeId;
use crate::tree::{DocumentNode, DocumentTree};

pub fn render<W: TreeWriter>(tree: &DocumentTree, root: NodeId, w: &mut W) -> Result<(), W::Error> {
    walk(tree, root, w)
}

fn walk<W: TreeWriter>(tree: &DocumentTree, id: NodeId, w: &mut W) -> Result<(), W::Error> {
    let Some(node) = tree.node(id) else {
        return Ok(());
    };

    match node.data() {
        DocumentNode::Root => kids(tree, id, w)?,
        DocumentNode::Section { level, kind, title, .. } => {
            w.enter_section(*level, *kind, title)?;
            kids(tree, id, w)?;
            w.leave_section(*level, *kind, title)?;
        }
        DocumentNode::Paragraph => {
            w.enter_paragraph()?;
            kids(tree, id, w)?;
            w.leave_paragraph()?;
        }
        DocumentNode::Html(html) => {
            w.write_html(html)?;
        }
        DocumentNode::List { style, spacing } => {
            w.enter_list(*style, *spacing)?;
            kids(tree, id, w)?;
            w.leave_list(*style, *spacing)?;
        }
        DocumentNode::ListItem => {
            w.enter_list_item()?;
            kids(tree, id, w)?;
            w.leave_list_item()?;
        }
        DocumentNode::CodeBlock { language, code } => {
            w.write_code_block(language.as_deref(), code)?;
        }
        DocumentNode::BlockQuote => {
            w.enter_blockquote()?;
            kids(tree, id, w)?;
            w.leave_blockquote()?;
        }
        DocumentNode::Table { alignments } => {
            w.enter_table(alignments)?;
            kids(tree, id, w)?;
            w.leave_table(alignments)?;
        }
        DocumentNode::TableRow => {
            w.enter_table_row()?;
            kids(tree, id, w)?;
            w.leave_table_row()?;
        }
        DocumentNode::TableCell => {
            w.enter_table_cell()?;
            kids(tree, id, w)?;
            w.leave_table_cell()?;
        }
        DocumentNode::Text(text) => {
            w.write_text(text)?;
        }
        DocumentNode::Strong => {
            w.enter_strong()?;
            kids(tree, id, w)?;
            w.leave_strong()?;
        }
        DocumentNode::Emphasis => {
            w.enter_emphasis()?;
            kids(tree, id, w)?;
            w.leave_emphasis()?;
        }
        DocumentNode::Link { target, title } => {
            w.enter_link(target, title.as_deref())?;
            kids(tree, id, w)?;
            w.leave_link(target, title.as_deref())?;
        }
        DocumentNode::Image { url, alt, .. } => {
            w.write_image(url, alt)?;
        }
        DocumentNode::ThematicBreak => {
            w.write_thematic_break()?;
        }
    }

    Ok(())
}

fn kids<W: TreeWriter>(tree: &DocumentTree, parent: NodeId, w: &mut W) -> Result<(), W::Error> {
    for child in tree.children(parent) {
        walk(tree, child.id(), w)?;
    }
    Ok(())
}
