use std::path::PathBuf;

use document_hierarchy::render;
use document_hierarchy::{MarkdownWriter, TreeParser};

fn xml() -> PathBuf {
    if let Some(path) = std::env::args_os().nth(1) {
        return PathBuf::from(path);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("examples")
        .join("assets")
        .join("boe-a-1978-31229-full.xml")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = xml();
    let tree = TreeParser::new().parse_xml_file(&path)?;
    let mut md_buf = String::new();
    let mut md = MarkdownWriter::new(&mut md_buf);
    render::render(&tree, tree.root(), &mut md)?;

    println!("XML: {}", path.display());
    println!("{tree}");
    println!("\n== Markdown ==\n{md_buf}");

    Ok(())
}
