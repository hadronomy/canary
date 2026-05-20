use crate::parser::DocumentMeta;
use crate::render;
use crate::render::markdown::{HeadingMode, MarkdownWriter};
use crate::tree::{DocumentNode, DocumentTree, DocumentTreeBuilder, HeadingLevel, SectionKind};

fn lvl(value: u8) -> HeadingLevel {
    HeadingLevel::new(value).expect("test heading level must be valid")
}

fn build(f: impl FnOnce(&mut DocumentTreeBuilder)) -> DocumentTree {
    let mut tree = DocumentTree::builder();
    f(&mut tree);
    tree.freeze()
}

#[test]
fn renders_markdown_section_and_paragraph() {
    let tree = build(|tree| {
        let sec = tree.add_child(tree.root(), DocumentNode::section(lvl(2), "Intro"));
        let para = tree.add_child(sec, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("Hello world"));
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::new(&mut out);
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("## Intro"));
    assert!(out.contains("Hello world"));
}

#[test]
fn renders_markdown_inline_nodes() {
    let tree = build(|tree| {
        let para = tree.add_child(tree.root(), DocumentNode::paragraph());
        let strong = tree.add_child(para, DocumentNode::strong());
        tree.add_child(strong, DocumentNode::text("bold"));
        let em = tree.add_child(para, DocumentNode::emphasis());
        tree.add_child(em, DocumentNode::text("soft"));
        let link = tree.add_child(para, DocumentNode::link_external("https://x.test", None));
        tree.add_child(link, DocumentNode::text("ref"));
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::new(&mut out);
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("**bold**"));
    assert!(out.contains("*soft*"));
    assert!(out.contains("[ref](https://x.test)"));
}

#[test]
fn does_not_emit_empty_quote_line_before_content() {
    let tree = build(|tree| {
        let quote = tree.add_child(tree.root(), DocumentNode::block_quote());
        let para = tree.add_child(quote, DocumentNode::paragraph());
        tree.add_child(para, DocumentNode::text("Texto nota"));
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::new(&mut out);
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("> Texto nota"));
    assert!(!out.contains("\n>\n> Texto nota"));
}

#[test]
fn renders_html_fallback_as_markdown() {
    let tree = build(|tree| {
        tree.add_child(
            tree.root(),
            DocumentNode::html("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>"),
        );
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::new(&mut out);
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("| A |"));
    assert!(out.contains("| 1 |"));
}

#[test]
fn renders_typed_table_nodes() {
    let tree = build(|tree| {
        let table = tree.add_child(tree.root(), DocumentNode::table(vec![None, None]));
        let head = tree.add_child(table, DocumentNode::table_row());
        let a = tree.add_child(head, DocumentNode::table_cell());
        let b = tree.add_child(head, DocumentNode::table_cell());
        tree.add_child(a, DocumentNode::text("A"));
        tree.add_child(b, DocumentNode::text("B"));
        let body = tree.add_child(table, DocumentNode::table_row());
        let one = tree.add_child(body, DocumentNode::table_cell());
        let two = tree.add_child(body, DocumentNode::table_cell());
        tree.add_child(one, DocumentNode::text("1"));
        tree.add_child(two, DocumentNode::text("2"));
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::new(&mut out);
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("| A | B |"));
    assert!(out.contains("| 1 | 2 |"));
}

#[test]
fn renders_boe_heading_when_enabled() {
    let tree = build(|tree| {
        tree.add_child(tree.root(), DocumentNode::section(lvl(2), "Intro"));
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::with_heading(
        &mut out,
        HeadingMode::Boe {
            meta: DocumentMeta {
                identifier: Some("BOE-A-1978-31229".to_string()),
                title: Some("Constitución Española.".to_string()),
                department: Some("Cortes Generales".to_string()),
                rango: Some("Constitución".to_string()),
                publication: Some("19781229".to_string()),
                eli: Some("https://www.boe.es/eli/es/c/1978/12/27/(1)".to_string()),
            },
            fragments: 800,
        },
    );
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("# Constitución Española."));
    assert!(out.contains("- Identificador: BOE-A-1978-31229"));
    assert!(out.contains("- Fragmentos: 800"));
    assert!(out.contains("## Intro"));
}

#[test]
fn forces_article_sections_to_h3() {
    let tree = build(|tree| {
        let title = tree.add_child(
            tree.root(),
            DocumentNode::section_with(lvl(2), SectionKind::Titulo, "TÍTULO I"),
        );
        let chap = tree.add_child(
            title,
            DocumentNode::section_with(lvl(3), SectionKind::Capitulo, "CAPÍTULO PRIMERO"),
        );
        tree.add_child(
            chap,
            DocumentNode::section_with(lvl(4), SectionKind::Articulo, "Artículo 15"),
        );
    });

    let mut out = String::new();
    let mut w = MarkdownWriter::with_heading(
        &mut out,
        HeadingMode::Boe { meta: DocumentMeta::default(), fragments: 0 },
    );
    render::render(&tree, tree.root(), &mut w).unwrap();

    assert!(out.contains("CAPÍTULO PRIMERO\n---"));
    assert!(out.contains("### Artículo 15"));
    assert!(!out.contains("##### Artículo 15"));
}
