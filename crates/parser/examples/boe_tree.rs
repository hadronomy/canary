use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

use document_hierarchy::render;
use document_hierarchy::{HeadingMode, MarkdownWriter, TreeParser};

fn xml() -> PathBuf {
    if let Some(path) = std::env::args_os().nth(1) {
        return PathBuf::from(path);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("examples")
        .join("assets")
        .join("boe-a-2021-13171-full.xml")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = xml();
    let parser = TreeParser::new();
    let doc = parser.parse_reader_document(BufReader::new(File::open(&path)?))?;
    let tree = parser.build_tree(&doc.blocks)?;
    let fragmentos = tree.descendants(tree.root()).count();

    let mut md_buf = String::new();
    let mut md = MarkdownWriter::with_heading(
        &mut md_buf,
        HeadingMode::Boe { meta: doc.meta.clone(), fragments: fragmentos },
    );
    render::render(&tree, tree.root(), &mut md)?;

    println!("XML: {}", path.display());
    println!("{tree}");
    println!("\n== Markdown ==\n{md_buf}");

    Ok(())
}
