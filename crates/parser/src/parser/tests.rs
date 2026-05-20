use super::*;

fn sample() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="ti" tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
          <p class="titulo_tit">Derechos</p>
        </version>
      </bloque>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno.</p>
        </version>
        <version fecha_vigencia="19920101">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno actualizado.</p>
          <blockquote>
            <p class="nota_pie">Texto nota <a class="refPost">Ref. BOE-A-1992-20403</a></p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#
}

#[test]
fn parses_xml_text() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let canon = tree.find_by_anchor("artículo-1").unwrap();
    let alias = tree.find_by_anchor("articulo-1").unwrap();
    assert_eq!(canon, alias);
}

#[test]
fn preserves_unsupported_html_as_html_node() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20210906">
          <p class="titulo_tit">ANEXO</p>
          <foo><bar>z</bar></foo>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("anexo").unwrap();
    let html = tree
        .children(id)
        .filter_map(|it| match it.data() {
            DocumentNode::Html(html) => Some(html.html()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(html.len(), 1);
    assert!(html[0].contains("<foo>"));
}

#[test]
fn parses_table_nodes_into_typed_tree() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20210906">
          <p class="titulo_tit">ANEXO</p>
          <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("anexo").unwrap();
    let table = tree.children(id).find(|it| matches!(it.data(), DocumentNode::Table(_))).unwrap();
    let rows = table
        .children()
        .filter(|it| matches!(it.data(), DocumentNode::TableRow))
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 2);
    let cells =
        rows[0].children().filter(|it| matches!(it.data(), DocumentNode::TableCell)).count();
    assert_eq!(cells, 2);
    assert!(tree.extract_text(table.id()).contains("A"));
    assert!(tree.extract_text(table.id()).contains("2"));
}

#[test]
fn parses_bytes() {
    let tree = TreeParser::new().parse_bytes(sample().as_bytes()).unwrap();
    assert!(tree.find_by_anchor("artículo-1").is_some());
}

#[test]
fn picks_latest_version() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let id = tree.find_by_anchor("artículo-1").unwrap();
    assert!(tree.extract_text(id).contains("actualizado"));
}

#[test]
fn picks_first_version() {
    let tree = TreeParser::new().policy(VersionPolicy::First).parse_xml(sample()).unwrap();
    let id = tree.find_by_anchor("artículo-1").unwrap();
    assert!(tree.extract_text(id).contains("Uno."));
    assert!(!tree.extract_text(id).contains("actualizado"));
}

#[test]
fn validates_root_path() {
    let err = TreeParser::new().parse_xml("<root><x/></root>").unwrap_err();
    assert!(err.to_string().contains("response/data/texto"));
}

#[test]
fn does_not_duplicate_refpost_text() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let id = tree.find_by_anchor("artículo-1").unwrap();
    let para = tree
        .descendants(id)
        .find(|it| matches!(it.data(), DocumentNode::Paragraph) && it.text().contains("Texto nota"))
        .unwrap();

    let parts = para
        .children()
        .map(|node| match node.data() {
            DocumentNode::Text(text) => format!("text:{}", text.text()),
            DocumentNode::Link(link) => format!("link:{}", link.target().key()),
            other => format!("other:{:?}", other.kind()),
        })
        .collect::<Vec<_>>();

    assert_eq!(
        parts,
        vec!["text:Texto nota".to_string(), "link:Ref. BOE-A-1992-20403".to_string()]
    );
}

#[test]
fn preserves_inline_reference_order_inside_paragraphs() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="20110927">
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Antes <a class="refPost">Ref. BOE-A-2011-15210</a> después</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("artículo-1").unwrap();
    let para = tree.children(id).find(|it| matches!(it.data(), DocumentNode::Paragraph)).unwrap();

    let parts = para
        .children()
        .map(|node| match node.data() {
            DocumentNode::Text(text) => format!("text:{}", text.text()),
            DocumentNode::Link(link) => format!("link:{}", link.target().key()),
            other => format!("other:{:?}", other.kind()),
        })
        .collect::<Vec<_>>();

    assert_eq!(
        parts,
        vec![
            "text:Antes".to_string(),
            "link:Ref. BOE-A-2011-15210".to_string(),
            "text:después".to_string()
        ]
    );
}

#[test]
fn compacts_double_dot_before_ref_link() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="20110927">
          <p class="articulo">Artículo 1</p>
          <blockquote>
            <p class="nota_pie">Se modifica por el art. único de la Reforma de 27 de septiembre de 2011. <a class="refPost">Ref. BOE-A-2011-15210</a>.</p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let mut out = String::new();
    let mut md = crate::MarkdownWriter::new(&mut out);
    crate::render::render(&tree, tree.root(), &mut md).unwrap();

    assert!(out.contains("2011.[Ref. BOE-A-2011-15210](Ref. BOE-A-2011-15210)"));
    assert!(!out.contains("2011..[Ref. BOE-A-2011-15210](Ref. BOE-A-2011-15210)"));
}

#[test]
fn renders_blockquote_notes() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let mut out = String::new();
    let mut md = crate::MarkdownWriter::new(&mut out);
    crate::render::render(&tree, tree.root(), &mut md).unwrap();

    assert!(out.contains("> Texto nota"));
    assert!(out.contains("[Ref. BOE-A-1992-20403](Ref. BOE-A-1992-20403)"));
}

#[test]
fn keeps_centro_as_in_section_divider() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="centro_negrita">CONSTITUCIÓN</p>
          <p class="articulo">Artículo 1</p>
          <p class="parrafo">Uno.</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let art = tree.find_by_anchor("artículo-1").unwrap();
    let mut found_divider = false;
    for child in tree.children(art) {
        if matches!(child.data(), DocumentNode::ThematicBreak) {
            found_divider = true;
        }
    }
    assert!(found_divider);
    assert!(tree.extract_text(art).contains("CONSTITUCIÓN"));
    assert!(tree.extract_text(art).contains("Uno."));
}

#[test]
fn groups_consecutive_quote_paragraphs_under_one_blockquote() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="precepto" titulo="Artículo 1">
        <version fecha_vigencia="19781229">
          <p class="articulo">Artículo 1</p>
          <blockquote>
            <p class="nota_pie">Nota uno.</p>
            <p class="nota_pie">Nota dos.</p>
          </blockquote>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let art = tree.find_by_anchor("artículo-1").unwrap();
    let quotes = tree
        .children(art)
        .filter(|id| matches!(id.data(), DocumentNode::BlockQuote))
        .collect::<Vec<_>>();

    assert_eq!(quotes.len(), 1);
    let paras =
        quotes[0].children().filter(|id| matches!(id.data(), DocumentNode::Paragraph)).count();
    assert_eq!(paras, 2);
}

#[test]
fn combines_adjacent_heading_paragraphs() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let id = tree.find_by_anchor("título-i-derechos").unwrap();
    let section = tree.get(id).unwrap();
    assert_eq!(section.section_title(), Some("TÍTULO I Derechos"));
}

#[test]
fn skips_heading_paragraphs_in_section_body() {
    let tree = TreeParser::new().parse_xml(sample()).unwrap();
    let id = tree.find_by_anchor("artículo-1").unwrap();
    let values = tree
        .children(id)
        .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
        .map(|it| it.text())
        .collect::<Vec<_>>();

    assert!(values.iter().all(|it| it != "Artículo 1"));
    assert!(values.contains(&"Uno actualizado.".to_string()));
}

#[test]
fn keeps_adjacent_unsupported_html_fragments_together() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20210906">
          <p class="titulo_tit">ANEXO</p>
          <foo><bar>z</bar></foo>
          <baz><qux>y</qux></baz>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("anexo").unwrap();
    let html = tree
        .children(id)
        .filter_map(|it| match it.data() {
            DocumentNode::Html(html) => Some(html.html()),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(html.len(), 1);
    assert!(html[0].contains("<foo>"));
    assert!(html[0].contains("<baz>"));
}

#[test]
fn consumes_anexo_heading_paragraphs() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="an" tipo="encabezado" titulo="ANEXO">
        <version fecha_vigencia="20220101">
          <p class="anexo_num">ANEXO</p>
          <p class="anexo_tit">Modelos de cuentas anuales consolidadas</p>
          <p class="centro_cursiva">Balance consolidado</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("anexo-modelos-de-cuentas-anuales-consolidadas").unwrap();
    let section = tree.get(id).unwrap();
    assert_eq!(section.section_title(), Some("ANEXO Modelos de cuentas anuales consolidadas"));

    let body = tree
        .children(id)
        .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
        .map(|it| it.text())
        .collect::<Vec<_>>();
    assert_eq!(body, vec!["Balance consolidado".to_string()]);
}

#[test]
fn consumes_plain_anexo_heading_paragraph() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="mc" tipo="encabezado" titulo="MEMORIA CONSOLIDADA">
        <version fecha_vigencia="20220101">
          <p class="anexo">MEMORIA CONSOLIDADA</p>
          <p class="centro_redonda">Contenido de la memoria consolidada</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let tree = TreeParser::new().parse_xml(xml).unwrap();
    let id = tree.find_by_anchor("memoria-consolidada").unwrap();
    let section = tree.get(id).unwrap();
    assert_eq!(section.section_title(), Some("MEMORIA CONSOLIDADA"));

    let body = tree
        .children(id)
        .filter(|it| matches!(it.data(), DocumentNode::Paragraph))
        .map(|it| it.text())
        .collect::<Vec<_>>();
    assert_eq!(body, vec!["Contenido de la memoria consolidada".to_string()]);
}

#[test]
fn keeps_missing_block_id_as_none() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert_eq!(doc.blocks[0].id, None);
}

#[test]
fn trims_blank_block_id_to_none() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="   " tipo="encabezado" titulo="TÍTULO I">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert_eq!(doc.blocks[0].id, None);
}

#[test]
fn trims_blank_block_title_to_none() {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<response>
  <data>
    <texto>
      <bloque id="a1" tipo="encabezado" titulo="   ">
        <version fecha_vigencia="19781229">
          <p class="titulo_num">TÍTULO I</p>
        </version>
      </bloque>
    </texto>
  </data>
</response>"#;

    let doc = TreeParser::new().parse_bytes_document(xml.as_bytes()).unwrap();
    assert_eq!(doc.blocks.len(), 1);
    assert_eq!(doc.blocks[0].title, None);
}

#[test]
fn parses_from_streaming_reader() {
    let reader = std::io::BufReader::with_capacity(1, std::io::Cursor::new(sample().as_bytes()));

    let tree = TreeParser::new().parse_reader(reader).unwrap();
    assert!(tree.find_by_anchor("artículo-1").is_some());
}
