# XML-First Parser Draft (BOE)

## Goal

Parse BOE consolidated XML (`/datosabiertos/api/legislacion-consolidada/.../texto`) as the primary source of truth and build `DocumentTree` directly, avoiding PDF layout/order issues.

## Input

- Source file: `examples/assets/boe-a-1978-31229-texto.xml`
- Root shape:
  - `response/status`
  - `response/data/texto`
  - repeated `bloque` nodes

## BOE XML Mapping

- `bloque[@tipo='encabezado']`
  - section-level nodes (`TÍTULO`, `CAPÍTULO`, `SECCIÓN`, etc.)
  - heading text from `<p class='titulo*|capitulo*|seccion*'>`
- `bloque[@tipo='precepto']`
  - article-level nodes (`Artículo N`)
  - heading text from `<p class='articulo'>`
  - paragraph body from `<p class='parrafo*'>`
- `bloque[@tipo='preambulo']`
  - preamble section + paragraphs
- `version`
  - select the active/current version per parse policy (default: latest `fecha_vigencia`)

## Public API Plan

Add XML entrypoints in `TreeParser`:

- `parse_xml(&self, xml: &str) -> Result<DocumentTree>`
- `parse_xml_file<P: AsRef<Path>>(&self, path: P) -> Result<DocumentTree>`

Replace legacy format entrypoints with XML-only `parse_xml`, `parse_xml_file`, and `parse_bytes`.

## Parser Architecture

1. Parse XML into a lightweight intermediate model:
   - `Block { id, kind, title, paras, meta }`
2. Build `DocumentTree` in one pass:
   - maintain a section stack by semantic level (`titulo > capitulo > seccion > articulo`)
   - attach paragraphs to current article/section
3. Anchor strategy:
   - for sections/articles: slug from canonical heading text
   - for duplicate headings: deterministic suffixing
4. Version policy:
   - choose one `version` branch consistently
   - optional future mode: emit historical variants

## Error Handling

Add `DocumentError::Xml(String)` and return it for:

- malformed XML
- missing required root paths (`response/data/texto`)
- empty extract after filtering

## Edge Cases

- multi-version `bloque` entries (same article changed over time)
- `blockquote` notes and amendment references (`nota_pie`, refs)
- mixed heading classes (`titulo_num`, `titulo_tit`, `capitulo_num`, etc.)
- legal enumerations inside paragraph text (`1.`, `a)`, `b)`)

## Implementation Steps

1. Add XML parser dependency (`quick-xml` or `roxmltree`) via `bun add` equivalent for Rust (`Cargo.toml` update).
2. Implement `parse_xml` + `parse_xml_file` in `parser.rs`.
3. Add BOE XML fixture tests:
   - section/article counts
   - known anchors (`articulo-93`, `disposicion-derogatoria`)
   - paragraph ordering under articles
4. Add example:
   - `examples/boe_xml_tree.rs` prints tree from XML input.

## Expected Outcome

- Deterministic, semantically ordered tree
- No PDF OCR/layout reorder artifacts
- Cleaner article/disposition assignment
