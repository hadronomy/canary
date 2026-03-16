use std::path::PathBuf;

use document_hierarchy::TreeParser;

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

    println!("XML: {}", path.display());
    println!("{tree}");

    Ok(())
}
