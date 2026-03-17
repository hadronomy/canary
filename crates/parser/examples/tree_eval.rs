use std::collections::BTreeMap;
use std::path::PathBuf;

use document_hierarchy::{DocumentTree, NodeId, NodeKind, TreeParser};

fn xml() -> PathBuf {
    if let Some(path) = std::env::args_os().nth(1) {
        return PathBuf::from(path);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("examples")
        .join("assets")
        .join("boe-a-1978-31229-full.xml")
}

fn limit() -> usize {
    let value =
        std::env::args().skip(2).find_map(|arg| arg.strip_prefix("--limit=").map(str::to_string));
    value.and_then(|it| it.parse::<usize>().ok()).unwrap_or(10)
}

fn kind(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::Root => "root",
        NodeKind::Section { .. } => "section",
        NodeKind::Paragraph => "paragraph",
        NodeKind::Html => "html",
        NodeKind::List { .. } => "list",
        NodeKind::ListItem => "list_item",
        NodeKind::CodeBlock { .. } => "code_block",
        NodeKind::BlockQuote => "blockquote",
        NodeKind::Table { .. } => "table",
        NodeKind::TableRow => "table_row",
        NodeKind::TableCell => "table_cell",
        NodeKind::Text => "text",
        NodeKind::Strong => "strong",
        NodeKind::Emphasis => "emphasis",
        NodeKind::Link { .. } => "link",
        NodeKind::Image { .. } => "image",
        NodeKind::ThematicBreak => "thematic_break",
    }
}

fn preview(text: &str) -> String {
    let line = text.split('\n').next().unwrap_or("").trim();
    if line.chars().count() <= 80 {
        return line.to_string();
    }
    format!("{}...", line.chars().take(77).collect::<String>())
}

fn span(tree: &DocumentTree, id: NodeId) -> usize {
    tree.descendants(id).count()
}

fn print_kinds(tree: &DocumentTree) {
    let mut map = BTreeMap::<&'static str, usize>::new();
    for id in tree.descendants(tree.root()) {
        if let Some(node) = tree.get(id) {
            *map.entry(kind(&node.kind)).or_default() += 1;
        }
    }

    let mut rows = map.into_iter().collect::<Vec<_>>();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));

    println!("\n== Node Kind Counts ==");
    for (name, count) in rows {
        println!("{:>16}: {}", name, count);
    }
}

fn print_sections(tree: &DocumentTree, n: usize) {
    let mut rows = tree
        .sections()
        .filter_map(|it| {
            let node = tree.get(it.id)?;
            Some((it.id, node.content.clone(), it.path, it.level, span(tree, it.id)))
        })
        .collect::<Vec<_>>();

    let count = rows.len();
    let max_level = rows.iter().map(|it| it.3).max().unwrap_or(0);
    let avg_level = if count == 0 {
        0.0
    } else {
        rows.iter().map(|it| usize::from(it.3)).sum::<usize>() as f64 / count as f64
    };
    let max_depth = rows
        .iter()
        .map(|it| if it.2 == "root" { 0 } else { it.2.split('.').count() })
        .max()
        .unwrap_or(0);

    println!("\n== Section Stats ==");
    println!("count           : {}", count);
    println!("max_level       : {}", max_level);
    println!("avg_level       : {:.2}", avg_level);
    println!("max_path_depth  : {}", max_depth);

    rows.sort_by(|a, b| b.4.cmp(&a.4).then_with(|| a.2.cmp(&b.2)));
    println!("\n== Top Section Titles (by subtree size) ==");
    for (idx, (_, title, path, level, size)) in rows.into_iter().take(n).enumerate() {
        println!("{:>2}. [{}] H{} nodes={}  {}", idx + 1, path, level, size, preview(&title));
    }
}

fn print_anchors(tree: &DocumentTree, n: usize) {
    let mut rows = tree
        .descendants(tree.root())
        .filter_map(|id| {
            let node = tree.get(id)?;
            let anchor = node.anchor.clone()?;
            let path = tree.hierarchical_path(id);
            Some((anchor, path, kind(&node.kind), span(tree, id), preview(&node.content)))
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.1.cmp(&b.1)));

    println!("\n== Top Anchors (by subtree size) ==");
    for (idx, (anchor, path, kind, size, text)) in rows.into_iter().take(n).enumerate() {
        println!("{:>2}. [{}] {} nodes={}  #{}  {}", idx + 1, path, kind, size, anchor, text);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = xml();
    let n = limit();
    let tree = TreeParser::new().parse_xml_file(&path)?;

    println!("XML: {}", path.display());
    println!("top_limit: {}", n);
    println!("total_nodes: {}", tree.descendants(tree.root()).count());

    print_kinds(&tree);
    print_sections(&tree, n);
    print_anchors(&tree, n);

    Ok(())
}
