import { describe, expect, test } from "bun:test";

import { Effect, Either } from "effect";

import {
  BoeXmlParser,
  evaluateQuery,
  extractTableText,
  formatFragmentsAsMarkdown,
  linearizeOrderedTextBlocks,
  normalizeSubparagraph,
  path,
  Query,
  selectByLegalPath,
} from "~/collectors/boe/parser";
import { normalizeArticleHeader, normalizeChapterHeader } from "~/collectors/boe/parser/normalize";
import { classifyBlock, toTextNode } from "~/collectors/boe/parser/traversal";

import {
  boeParserMetadata as parserMetadata,
  parseBoe,
  parseBoeDocument as parseDocument,
  parseBoeFragments as parseToFragments,
  readBoeFixture as readFixture,
} from "../common";

describe("Parser additional coverage", () => {
  test("parseDocument extracts complete document model", async () => {
    const xml = await readFixture("legislative-full.xml");
    const document = await parseDocument(xml);

    expect(document.metadata).toBeDefined();
    expect(document.analysis).toBeDefined();
    expect(document.text).toBeDefined();
    expect(document.text.length).toBeGreaterThan(0);
  });

  test("handles XML with special characters and entities", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<documento fecha_actualizacion="20240101">
  <metadatos>
    <identificador>BOE-A-2024-TEST</identificador>
    <titulo>Test &amp; Document</titulo>
    <departamento>Test &lt;Dept&gt;</departamento>
    <rango codigo="1000">Test</rango>
    <seccion>1</seccion>
    <subseccion>A</subseccion>
    <fecha_publicacion>20240101</fecha_publicacion>
    <url_pdf>/test.pdf</url_pdf>
    <url_eli>/eli</url_eli>
  </metadatos>
  <analisis>
    <materias><materia>Test</materia></materias>
    <notas><nota>Note</nota></notas>
    <referencias>
      <anteriores><anterior><referencia>REF1</referencia><tipo>tipo1</tipo></anterior></anteriores>
      <posteriores></posteriores>
    </referencias>
  </analisis>
  <texto>
    <p class="parrafo">Content with &amp; and &lt;tags&gt;.</p>
  </texto>
</documento>`;

    const fragments = await parseToFragments(xml);
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0]?.content).toContain("&");
  });

  test("handles empty analysis sections gracefully", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<documento fecha_actualizacion="20240101">
  <metadatos>
    <identificador>BOE-A-2024-TEST</identificador>
    <titulo>Test Document</titulo>
    <departamento>Test Dept</departamento>
    <rango codigo="1000">Test</rango>
    <seccion>1</seccion>
    <subseccion>A</subseccion>
    <fecha_publicacion>20240101</fecha_publicacion>
    <url_pdf>/test.pdf</url_pdf>
    <url_eli>/eli</url_eli>
  </metadatos>
  <analisis>
    <materias></materias>
    <notas></notas>
    <referencias>
      <anteriores></anteriores>
      <posteriores></posteriores>
    </referencias>
  </analisis>
  <texto>
    <p class="parrafo">Test content.</p>
  </texto>
</documento>`;

    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  test("handles XML with tables containing nested structures", async () => {
    const xml = await readFixture("with-tables.xml");
    const fragments = await parseToFragments(xml);

    const tableFragments = fragments.filter((f) => f.nodePath.includes("/t/"));
    expect(tableFragments.length).toBeGreaterThan(0);
  });

  test("fragmentBuilder article method handles title correctly", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder
          .article({ number: "1.º", title: "Articulo Primero" })
          .paragraph("Contenido.")
          .build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const article = fragments.find((f) => f.nodeType === "article");
    expect(article).toBeDefined();
    expect(article?.nodeTitle).toBe("Articulo Primero");
    expect(article?.content).toContain("Articulo Primero");
  });

  test("fragmentBuilder article method handles article without title", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder.article({ number: "2.º" }).paragraph("Contenido.").build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const article = fragments.find((f) => f.nodeType === "article" && f.nodeNumber === "2.º");
    expect(article).toBeDefined();
  });
});

describe("Parser edge-case coverage", () => {
  test("toTextNode handles table token", () => {
    const token = { _tag: "table" as const, content: "Table data" };
    const node = toTextNode(token);
    expect(node._tag).toBe("raw");
    if (node._tag === "raw") {
      expect(node.content).toBe("Table data");
    }
  });

  test("toTextNode handles signature token", () => {
    const token = { _tag: "signature" as const, role: "firma_rey", content: "Felipe R." };
    const node = toTextNode(token);
    expect(node._tag).toBe("signature");
    if (node._tag === "signature") {
      expect(node.role).toBe("firma_rey");
      expect(node.content).toBe("Felipe R.");
    }
  });

  test("classifyBlock handles table block", () => {
    const block = { kind: "table" as const, text: "Header | Data\nA | B" };
    const classified = classifyBlock(block);
    expect(classified._tag).toBe("table");
  });

  test("classifyBlock handles signature blocks", () => {
    const blockRey = { kind: "paragraph" as const, className: "firma_rey", text: "Felipe R." };
    const classifiedRey = classifyBlock(blockRey);
    expect(classifiedRey._tag).toBe("signature");

    const blockMinistro = {
      kind: "paragraph" as const,
      className: "firma_ministro",
      text: "Ministro",
    };
    const classifiedMinistro = classifyBlock(blockMinistro);
    expect(classifiedMinistro._tag).toBe("signature");
  });

  test("extractTableText handles nested table structures", () => {
    const tableData = {
      tbody: {
        tr: [
          {
            th: [{ "#text": "Col1" }],
            td: [{ "#text": "Val1" }],
          },
        ],
      },
    };
    const result = extractTableText(tableData);
    expect(result).toContain("Col1");
  });

  test("evaluateQuery returns NotFound when article not found after filtering by paragraph", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.article("1", { paragraph: 999 }));
    expect(result._tag).toBe("NotFound");
  });

  test("selectByLegalPath handles fragments without legalNodePath", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "simple",
        blocks: [{ kind: "paragraph" as const, className: "parrafo", text: "Content" }],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const selected = selectByLegalPath(fragments, path<"legal">`/article/${1}`);
    expect(selected).toEqual([]);
  });

  test("queryLegal with paragraph filter returns NotFound when no match", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const document = await parseBoe(xml);
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        document,
        query: Query.article("1", { paragraph: 999 }),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );
    expect(result._tag).toBe("NotFound");
  });

  test("linearizeOrderedTextBlocks handles collectText with nested objects", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                ":@": { "@_class": "parrafo" },
                p: [{ "#text": "Text", span: { "#text": "Span" } }],
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks.length).toBe(1);
  });

  test("linearizeOrderedTextBlocks handles table with nested tr", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                table: {
                  tbody: {
                    tr: [{ th: ["Header"], td: ["Data"] }],
                  },
                },
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks.length).toBe(1);
  });

  test("applyToken handles subparagraph without current paragraph context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "articulo", text: "Art. 1." },
          { kind: "paragraph" as const, className: "parrafo_2", text: "a) Option A" },
          { kind: "paragraph" as const, className: "parrafo_2", text: "b) Option B" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subparagraphs = fragments.filter((f) => f.nodeType === "subparagraph");
    expect(subparagraphs.length).toBe(2);
  });

  test("normalizeSubparagraph handles ordinal markers with spaces", () => {
    const result1 = normalizeSubparagraph("1. ª Primera");
    expect(result1.marker).toBe("1ª");
    expect(result1.content).toBe("Primera");

    const result2 = normalizeSubparagraph("22. º Vigesima");
    expect(result2.marker).toBe("22º");
    expect(result2.content).toBe("Vigesima");
  });

  test("formatFragmentsAsMarkdown handles section and subsection headings", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "seccion", text: "SECCION I" },
          { kind: "paragraph" as const, className: "centro_cursiva", text: "Subsection Title" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const markdown = formatFragmentsAsMarkdown(fragments, "/");
    expect(markdown).toContain("SECCION I");
    expect(markdown).toContain("Subsection Title");
  });

  test("parseDocument handles XML with subjects as non-array", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<documento fecha_actualizacion="20240101">
  <metadatos>
    <identificador>BOE-A-2024-TEST</identificador>
    <titulo>Test</titulo>
    <departamento>Test</departamento>
    <rango codigo="1000">Test</rango>
    <seccion>1</seccion>
    <subseccion>A</subseccion>
    <fecha_publicacion>20240101</fecha_publicacion>
    <url_pdf>/test.pdf</url_pdf>
    <url_eli>/eli</url_eli>
  </metadatos>
  <analisis>
    <materias><materia>Subject1</materia></materias>
    <notas><nota>Note1</nota></notas>
    <referencias>
      <anteriores><anterior><referencia>REF1</referencia><tipo>T1</tipo></anterior></anteriores>
      <posteriores><posterior><referencia>REF2</referencia><tipo>T2</tipo></posterior></posteriores>
    </referencias>
  </analisis>
  <texto>
    <p class="parrafo">Content.</p>
  </texto>
</documento>`;

    const document = await parseDocument(xml);
    expect(document.analysis.subjects).toContain("Subject1");
  });

  test("parseDocument handles number as text content", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<documento fecha_actualizacion="20240101">
  <metadatos>
    <identificador>BOE-A-2024-TEST</identificador>
    <titulo>Test</titulo>
    <departamento>Test</departamento>
    <rango codigo="1000">Test</rango>
    <seccion>1</seccion>
    <subseccion>A</subseccion>
    <fecha_publicacion>20240101</fecha_publicacion>
    <url_pdf>/test.pdf</url_pdf>
    <url_eli>/eli</url_eli>
  </metadatos>
  <analisis>
    <materias><materia>123</materia></materias>
  </analisis>
  <texto>
    <p class="parrafo">Content.</p>
  </texto>
</documento>`;

    const document = await parseDocument(xml);
    expect(document.analysis.subjects).toContain("123");
  });

  test("selectByLegalPath returns empty when no fragments have legalNodePath", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "simple",
        blocks: [
          { kind: "paragraph" as const, className: "parrafo", text: "Content 1" },
          { kind: "paragraph" as const, className: "parrafo", text: "Content 2" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const selected = selectByLegalPath(fragments, path<"legal">`/article/${1}`);
    expect(selected).toEqual([]);
  });

  test("evaluateQuery handles empty fragments", () => {
    const result = evaluateQuery([], Query.all());
    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBe(0);
    }
  });

  test("formatFragmentsAsMarkdown handles subparagraph with nodeNumber", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "articulo", text: "Art. 1." },
          { kind: "paragraph" as const, className: "parrafo_2", text: "a) First option" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const markdown = formatFragmentsAsMarkdown(fragments, "/");
    expect(markdown).toContain("a) First option");
  });

  test("parseDocument with complete metadata", async () => {
    const xml = await readFixture("legislative-full.xml");
    const document = await parseDocument(xml);

    expect(document.metadata.identifier).toBeTruthy();
    expect(document.metadata.title).toBeTruthy();
    expect(document.metadata.department).toBeTruthy();
    expect(document.metadata.documentType).toBeTruthy();
    expect(document.metadata.publicationDate).toMatch(/^\d{8}$/);
  });

  test("linearizeOrderedTextBlocks handles empty p array", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                ":@": { "@_class": "parrafo" },
                p: [],
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks).toEqual([]);
  });

  test("applyToken handles paragraph after signature", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph" as const, className: "articulo", text: "Art. 1." },
          { kind: "paragraph" as const, className: "firma_rey", text: "Firma Real" },
          { kind: "paragraph" as const, className: "parrafo", text: "Post-signature content" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const postSignature = fragments.find((f) => f.content === "Post-signature content");
    expect(postSignature).toBeDefined();
    expect(postSignature?.nodePath.startsWith("/c/1/a/1/p/")).toBe(true);
  });

  test("applyToken handles subparagraph with ordinal markers", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "articulo", text: "Art. 1." },
          { kind: "paragraph" as const, className: "parrafo", text: "Main paragraph." },
          { kind: "paragraph" as const, className: "parrafo_2", text: "1.ª Primera disposicion" },
          { kind: "paragraph" as const, className: "parrafo_2", text: "2.ª Segunda disposicion" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subparagraphs = fragments.filter((f) => f.nodeType === "subparagraph");
    expect(subparagraphs.length).toBeGreaterThan(0);
    expect(subparagraphs.some((f) => f.nodeNumber === "1ª")).toBe(true);
    expect(subparagraphs.some((f) => f.nodeNumber === "2ª")).toBe(true);
  });

  test("normalizeChapterHeader with special marker", () => {
    const result = normalizeChapterHeader("[encabezado] TITULO ESPECIAL");
    expect(result.isSpecial).toBe(true);
    expect(result.title).toBe("TITULO ESPECIAL");
  });

  test("normalizeArticleHeader with precepto pattern", () => {
    const result = normalizeArticleHeader("[precepto] Primera. Disposicion adicional");
    expect(result.number).toBe("Primera");
    expect(result.title).toBe("Disposicion adicional");
  });

  test("normalizeArticleHeader with no match returns full text", () => {
    const result = normalizeArticleHeader("Texto sin patron");
    expect(result.number).toBe("Texto sin patron");
    expect(result.title).toBe("");
  });

  test("normalizeArticleHeader extracts number and title from long spanish article heading", () => {
    const result = normalizeArticleHeader(
      "Artículo quinto. Se modifican los siguientes artículos de la Ley Foral 10/1996, de 2 de julio",
    );

    expect(result.number).toBe("quinto");
    expect(result.title).toBe(
      "Se modifican los siguientes artículos de la Ley Foral 10/1996, de 2 de julio",
    );
    expect(result.number.length).toBeLessThanOrEqual(50);
  });

  test("normalizeArticleHeader keeps short numeric article number when no punctuation separator", () => {
    const result = normalizeArticleHeader(
      "Artículo 44 del Texto Refundido de la Ley Foral del Impuesto sobre la Renta",
    );

    expect(result.number).toBe("44");
    expect(result.title).toBe("del Texto Refundido de la Ley Foral del Impuesto sobre la Renta");
  });

  test("normalizeArticleHeader extracts disposition-style article numbers", () => {
    const result = normalizeArticleHeader(
      "Disposición adicional tercera. Modificación de la tabla de coeficientes",
    );

    expect(result.number).toBe("Disposición adicional tercera");
    expect(result.title).toBe("Modificación de la tabla de coeficientes");
    expect(result.number.length).toBeLessThanOrEqual(50);
  });

  test("formatFragmentsAsMarkdown handles annex with header path", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "anexo_tit", text: "Titulo Anexo" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const markdown = formatFragmentsAsMarkdown(fragments, "/");
    expect(markdown).toContain("Titulo Anexo");
  });

  test("queryLegal handles ByLegalPath query", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const document = await parseBoe(xml);
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        document,
        query: Query.byLegalPath(path<"legal">`/article/${1}`),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });

  test("queryLegal handles All query", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const document = await parseBoe(xml);
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        document,
        query: Query.all(),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });
});
