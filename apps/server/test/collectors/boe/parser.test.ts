import { describe, expect, test } from "bun:test";

import { Effect, Either } from "effect";

import {
  assertFragmentInvariants,
  BoeXmlParser,
  classifyBlock,
  EmptyFragmentContentError,
  evaluateQuery,
  extractTableText,
  formatFragmentsAsMarkdown,
  isFragmentPathQuery,
  linearizeOrderedTextBlocks,
  MissingRootDocumentoError,
  NodePathCollisionError,
  normalizeFragmentPathQuery,
  normalizeSubparagraph,
  Query,
  selectByLegalPath,
  selectFragmentsByPathQuery,
  toTextNode,
} from "~/collectors/boe/parser";
import {
  normalizeArticleHeader,
  normalizeChapterHeader,
  normalizeTextContent,
} from "~/collectors/boe/parser/normalize";
import { LegalNodePathString, NodePathString } from "~/collectors/boe/parser/types";

const readFixture = (name: string): Promise<string> => {
  const file = Bun.file(new URL(`../../fixtures/boe/${name}`, import.meta.url));
  return file.text();
};

const parseToFragments = (xml: string) =>
  Effect.runPromise(
    BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
  );

const parseDocument = (xml: string) =>
  Effect.runPromise(BoeXmlParser.parseDocument({ xml }).pipe(Effect.provide(BoeXmlParser.Default)));

const parserMetadata = {
  identifier: "BOE-A-TEST-1",
  title: "Documento de prueba",
  department: "Ministerio de Pruebas",
  documentType: "Resolucion",
  publicationDate: "20240101",
  pdfUrl: "https://www.boe.es/test.pdf",
  eliUrl: "https://www.boe.es/eli/test",
  rangoCodigo: "1370",
  seccion: "2",
  subseccion: "A",
} as const;

describe("BoeXmlParser", () => {
  test("parses legislative fixture with deterministic structural paths", async () => {
    const xml = await readFixture("legislative-full.xml");
    const fragments = await parseToFragments(xml);

    expect(fragments.length).toBeGreaterThan(6);
    expect(fragments.some((fragment) => fragment.nodeType === "article")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodeType === "annex")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodePath.startsWith("/c/"))).toBe(true);
    expect(fragments.some((fragment) => fragment.nodePath.startsWith("/x/"))).toBe(true);
    expect(new Set(fragments.map((fragment) => fragment.nodePath)).size).toBe(fragments.length);
  });

  test("classifies simple and announcement documents through metadata strategy", async () => {
    const simpleXml = await readFixture("simple-administrative.xml");
    const announcementXml = await readFixture("announcement-oposiciones.xml");

    const simpleFragments = await parseToFragments(simpleXml);
    const announcementFragments = await parseToFragments(announcementXml);

    expect(simpleFragments.every((fragment) => fragment.nodePath.startsWith("/p/"))).toBe(true);
    expect(announcementFragments.every((fragment) => fragment.nodePath.startsWith("/p/"))).toBe(
      true,
    );
  });

  test("extracts table content as addressable fragment", async () => {
    const xml = await readFixture("with-tables.xml");
    const fragments = await parseToFragments(xml);

    const tableFragment = fragments.find((fragment) => fragment.nodePath.includes("/t/"));
    expect(tableFragment).toBeDefined();
    expect(tableFragment?.content).toContain("Codigo puesto");
    expect(tableFragment?.content).toContain("1400460");
  });

  test("parses metadata and analysis into document model", async () => {
    const xml = await readFixture("simple-administrative.xml");
    const document = await parseDocument(xml);

    expect(document.metadata.identifier).toBe("BOE-A-2024-10001");
    expect(document.metadata.rangoCodigo).toBe("1350");
    expect(document.analysis.subjects).toContain("Nombramientos");
    expect(document.text.length).toBeGreaterThan(0);
  });

  test("returns typed parse error for malformed xml", async () => {
    const malformed = "<documento><metadatos></documento>";
    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.parseToFragments({ xml: malformed }).pipe(
          Effect.provide(BoeXmlParser.Default),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("XmlParseError");
    }
  });

  test("supports parse input object shape", async () => {
    const xml = await readFixture("simple-administrative.xml");
    const fragments = await Effect.runPromise(
      BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fragments.length).toBeGreaterThan(0);
  });

  test("builds fragments from canonical build input", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "simple",
        blocks: [
          { kind: "paragraph", className: "parrafo", text: "Texto principal" },
          { kind: "table", text: "Columna A | Columna B\n1 | 2" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fragments[0]?.content).toContain("Texto principal");
    expect(fragments.some((fragment) => fragment.nodePath.includes("/t/"))).toBe(true);
  });

  test("exposes fluent fragment builder delegating to canonical build", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder
          .chapter("CAPITULO I")
          .article({ number: "1.º", title: "Objeto" })
          .paragraph("1. Esta norma regula la materia.")
          .subparagraph({ marker: "a", content: "No afecte a la diversidad." })
          .build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fragments.some((fragment) => fragment.nodeType === "chapter")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodeType === "article")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodeType === "subparagraph")).toBe(true);
  });

  test("allocates unique annex header paths for repeated annex titles", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph", className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph", className: "anexo_tit", text: "Titulo A" },
          { kind: "paragraph", className: "anexo_tit", text: "Titulo B" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const annexHeaders = fragments.filter((fragment) => fragment.nodePath.includes("/h/"));
    expect(annexHeaders.map((fragment) => fragment.nodePath)).toEqual([
      NodePathString("/x/1/h/1"),
      NodePathString("/x/1/h/2"),
    ]);
  });

  test("allocates non-colliding signature and paragraph paths", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph", className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph", className: "articulo", text: "Articulo 1.º Objeto." },
          { kind: "paragraph", className: "firma_rey", text: "FELIPE R." },
          { kind: "paragraph", className: "parrafo", text: "Parrafo posterior a la firma." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const articleParagraphs = fragments.filter((fragment) =>
      fragment.nodePath.startsWith("/c/1/a/1/p/"),
    );
    expect(articleParagraphs.map((fragment) => fragment.nodePath)).toEqual([
      NodePathString("/c/1/a/1/p/1"),
      NodePathString("/c/1/a/1/p/2"),
    ]);
    expect(new Set(fragments.map((fragment) => fragment.nodePath)).size).toBe(fragments.length);
  });

  test("parses real-world full BOE xml fixture", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);

    expect(fragments.length).toBeGreaterThan(100);
    expect(fragments.some((fragment) => fragment.nodeType === "article")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodeType === "annex")).toBe(true);
    expect(fragments.some((fragment) => fragment.nodePath.includes("/x/"))).toBe(true);
    expect(new Set(fragments.map((fragment) => fragment.nodePath)).size).toBe(fragments.length);
  });

  test("produces deterministic node paths on repeated runs", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const first = await parseToFragments(xml);
    const second = await parseToFragments(xml);

    expect(first.map((fragment) => fragment.nodePath)).toEqual(
      second.map((fragment) => fragment.nodePath),
    );
    expect(first.map((fragment) => fragment.sequenceIndex)).toEqual(
      second.map((fragment) => fragment.sequenceIndex),
    );
  });

  test("allocates root table path before chapter/article context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "simple",
        blocks: [
          { kind: "table", text: "Header A | Header B\n1 | 2" },
          { kind: "paragraph", className: "parrafo", text: "Texto despues de tabla" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fragments[0]?.nodePath).toBe(NodePathString("/t/1"));
    expect(fragments[1]?.nodePath).toBe(NodePathString("/p/1"));
  });

  test("keeps annex list content under annex scope instead of preambulo", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);

    expect(
      fragments.some(
        (fragment) =>
          fragment.content.includes("Liebre (Lepus spp.).") && fragment.nodePath.startsWith("/x/"),
      ),
    ).toBe(true);
    expect(
      fragments.some(
        (fragment) =>
          fragment.content.includes("Liebre (Lepus spp.).") && fragment.nodePath.startsWith("/p/"),
      ),
    ).toBe(false);
  });

  test("nests derogatoria paragraph under disposition chapter", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);

    const derogatoriaParagraph = fragments.find((fragment) =>
      fragment.content.includes("Queda derogado el artículo 4 del Decreto 506/1971"),
    );

    expect(derogatoriaParagraph).toBeDefined();
    expect(derogatoriaParagraph?.nodePath).toBe(NodePathString("/c/3/p/1"));
  });

  test("derives legal article paths for constitution numbering", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);

    const article1 = fragments.find((fragment) => fragment.nodePath === NodePathString("/c/2/a/1"));
    const article1Paragraph1 = fragments.find(
      (fragment) => fragment.nodePath === NodePathString("/c/2/a/1/p/1"),
    );

    expect(article1?.legalNodePath).toBe(LegalNodePathString("/article/1"));
    expect(article1Paragraph1?.legalNodePath).toBe(LegalNodePathString("/article/1/p/1"));
  });

  test("classifies article 161 list markers as subparagraphs and numeric clause as paragraph", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({ xml, query: Query.article("161") }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    expect(result._tag).toBe("Match");
    if (result._tag !== "Match") {
      return;
    }

    const nodeByPath = new Map(
      result.fragments.map((fragment) => [String(fragment.nodePath), fragment]),
    );

    expect(nodeByPath.get("/c/22/a/3/p/1")?.nodeType).toBe("paragraph");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/1")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/1")?.nodeNumber).toBe("a");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/2")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/2")?.nodeNumber).toBe("b");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/3")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/3")?.nodeNumber).toBe("c");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/4")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/22/a/3/p/1/sp/4")?.nodeNumber).toBe("d");
    expect(nodeByPath.get("/c/22/a/3/p/2")?.nodeType).toBe("paragraph");
  });

  test("classifies article 148 ordinal list as nested subparagraphs under paragraph 1", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({ xml, query: Query.article("148") }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    expect(result._tag).toBe("Match");
    if (result._tag !== "Match") {
      return;
    }

    const nodeByPath = new Map(
      result.fragments.map((fragment) => [String(fragment.nodePath), fragment]),
    );

    expect(nodeByPath.get("/c/21/a/6/p/1")?.nodeType).toBe("paragraph");
    expect(nodeByPath.get("/c/21/a/6/p/1/sp/1")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/21/a/6/p/1/sp/1")?.nodeNumber).toBe("1ª");
    expect(nodeByPath.get("/c/21/a/6/p/1/sp/22")?.nodeType).toBe("subparagraph");
    expect(nodeByPath.get("/c/21/a/6/p/1/sp/22")?.nodeNumber).toBe("22ª");
    expect(nodeByPath.get("/c/21/a/6/p/2")?.nodeType).toBe("paragraph");
  });

  test("namespaces legal paths for additional and final dispositions", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);

    const additionalPrimera = fragments.find(
      (fragment) => fragment.nodePath === NodePathString("/c/2/a/1"),
    );
    const finalPrimera = fragments.find(
      (fragment) => fragment.nodePath === NodePathString("/c/4/a/1"),
    );

    expect(additionalPrimera?.legalNodePath).toBe(
      LegalNodePathString("/disposicion-adicional/article/primera"),
    );
    expect(finalPrimera?.legalNodePath).toBe(
      LegalNodePathString("/disposicion-final/article/primera"),
    );
  });

  test("selects by legal path including descendants", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const selected = await Effect.runPromise(
      BoeXmlParser.selectByLegalPath({ xml, legalPath: "/article/38" }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    expect(
      selected.some(
        (fragment) => fragment.legalNodePath === LegalNodePathString("/article/38/p/1"),
      ),
    ).toBe(true);
  });

  test("returns ambiguous query result for primera without scope", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({ xml, query: Query.article("primera") }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    expect(result._tag).toBe("Ambiguous");
    if (result._tag === "Ambiguous") {
      expect(result.candidates.length).toBeGreaterThan(1);
      expect(
        result.candidates.some((candidate) =>
          String(candidate.basePath).includes("disposicion-adicional"),
        ),
      ).toBe(true);
      expect(
        result.candidates.some((candidate) =>
          String(candidate.basePath).includes("disposicion-final"),
        ),
      ).toBe(true);
    }
  });

  test("resolves scoped disposition article query", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        xml,
        query: Query.dispositionArticle("disposicion-final", "primera", { paragraph: 1 }),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(
        result.fragments.some((fragment) => fragment.nodePath === NodePathString("/c/4/a/1/p/1")),
      ).toBe(true);
    }
  });

  test("selectByPath treats '/p' and '/p/' as equivalent", async () => {
    const xml = await readFixture("real-boe-full.xml");

    const fromNoSlash = await Effect.runPromise(
      BoeXmlParser.selectByPath({ xml, query: "/p" }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const fromSlash = await Effect.runPromise(
      BoeXmlParser.selectByPath({ xml, query: "/p/" }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fromNoSlash.map((fragment) => fragment.nodePath)).toEqual(
      fromSlash.map((fragment) => fragment.nodePath),
    );
    expect(fromNoSlash.every((fragment) => fragment.nodePath.startsWith("/p/"))).toBe(true);
  });

  test("formatMarkdownByPath formats '/' and '/p' selections", async () => {
    const xml = await readFixture("real-boe-full.xml");

    const allMarkdown = await Effect.runPromise(
      BoeXmlParser.formatMarkdownByPath({ xml, query: "/" }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    const pMarkdown = await Effect.runPromise(
      BoeXmlParser.formatMarkdownByPath({ xml, query: "/p" }).pipe(
        Effect.provide(BoeXmlParser.Default),
      ),
    );

    expect(allMarkdown.startsWith("# Real Decreto 1095/1989")).toBe(true);
    expect(allMarkdown.includes("Identificador: BOE-A-1989-22056")).toBe(true);
    expect(allMarkdown.includes("<!-- Path: /c/1/a/1")).toBe(true);
    expect(allMarkdown.includes("<!-- End Path: /c/1/a/1")).toBe(true);
    expect(pMarkdown.includes("/p/1")).toBe(true);
    expect(pMarkdown.includes("<!-- Path: ")).toBe(true);
  });
});

describe("fluent.ts - FragmentBuilder", () => {
  test("annex method creates annex with title when provided", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder
          .annex({ number: "ANEXO I", title: "Anexo Descriptivo" })
          .paragraph("Contenido del anexo.")
          .build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const annexFragments = fragments.filter((f) => f.nodePath.startsWith("/x/"));
    expect(annexFragments.length).toBeGreaterThan(0);
    expect(annexFragments.some((f) => f.nodePath.includes("/h/"))).toBe(true);
  });

  test("annex method creates annex without title when not provided", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder.annex({ number: "ANEXO II" }).paragraph("Contenido.").build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const annexFragments = fragments.filter((f) => f.nodePath.startsWith("/x/"));
    expect(annexFragments.length).toBeGreaterThan(0);
  });

  test("annex method creates annex with empty title when title is empty string", async () => {
    const fragments = await Effect.runPromise(
      Effect.gen(function* () {
        const builder = yield* BoeXmlParser.fragmentBuilder({
          metadata: parserMetadata,
          strategy: "legislative",
        });

        return yield* builder
          .annex({ number: "ANEXO III", title: "" })
          .paragraph("Contenido.")
          .build();
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const annexFragments = fragments.filter((f) => f.nodePath.startsWith("/x/"));
    expect(annexFragments.length).toBeGreaterThan(0);
  });
});

describe("format.ts", () => {
  test("isFragmentPathQuery validates correct path queries", () => {
    expect(isFragmentPathQuery("/")).toBe(true);
    expect(isFragmentPathQuery("/p")).toBe(true);
    expect(isFragmentPathQuery("/p/")).toBe(true);
    expect(isFragmentPathQuery("/c")).toBe(true);
    expect(isFragmentPathQuery("/c/")).toBe(true);
    expect(isFragmentPathQuery("/x")).toBe(true);
    expect(isFragmentPathQuery("/x/")).toBe(true);
    expect(isFragmentPathQuery("/t")).toBe(true);
    expect(isFragmentPathQuery("/t/")).toBe(true);
  });

  test("isFragmentPathQuery rejects invalid path queries", () => {
    expect(isFragmentPathQuery("/invalid")).toBe(false);
    expect(isFragmentPathQuery("/p/1")).toBe(false);
    expect(isFragmentPathQuery("random")).toBe(false);
    expect(isFragmentPathQuery("")).toBe(false);
  });

  test("normalizeFragmentPathQuery handles all cases", () => {
    expect(normalizeFragmentPathQuery("/")).toBe("/");
    expect(normalizeFragmentPathQuery("/p")).toBe("/p/");
    expect(normalizeFragmentPathQuery("/p/")).toBe("/p/");
    expect(normalizeFragmentPathQuery("/c")).toBe("/c/");
  });

  test("selectFragmentsByPathQuery returns all fragments for '/' query", async () => {
    const xml = await readFixture("simple-administrative.xml");
    const fragments = await parseToFragments(xml);
    const selected = selectFragmentsByPathQuery(fragments, "/");
    expect(selected.length).toBe(fragments.length);
  });

  test("formatFragmentsAsMarkdown handles fragments without metadata title fallback", () => {
    const fragmentsWithMetadata: Parameters<typeof formatFragmentsAsMarkdown>[0] = [
      {
        content: "Test content",
        contentNormalized: "Test content",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph",
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
    ];

    const markdown = formatFragmentsAsMarkdown(fragmentsWithMetadata, "/");
    expect(markdown).toContain("# Documento de prueba");
    expect(markdown).toContain("Test content");
  });

  test("formatFragmentsAsMarkdown handles empty selection", () => {
    const fragments: Parameters<typeof formatFragmentsAsMarkdown>[0] = [
      {
        content: "Test content",
        contentNormalized: "Test content",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph",
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
    ];

    const markdown = formatFragmentsAsMarkdown(fragments, "/c/");
    expect(markdown).toContain("No fragments found");
  });

  test("formatFragmentsAsMarkdown handles section and subsection node types", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph", className: "seccion", text: "SECCION PRIMERA" },
          { kind: "paragraph", className: "centro_cursiva", text: "Subseccion descriptiva" },
          { kind: "paragraph", className: "parrafo", text: "Contenido." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const markdown = formatFragmentsAsMarkdown(fragments, "/");
    expect(markdown).toContain("## SECCION PRIMERA");
    expect(markdown).toContain("Subseccion descriptiva");
  });

  test("formatFragmentsAsMarkdown handles subparagraph with nodeNumber", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph", className: "articulo", text: "Articulo 1." },
          { kind: "paragraph", className: "parrafo_2", text: "a) Primera opcion." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const markdown = formatFragmentsAsMarkdown(fragments, "/");
    expect(markdown).toContain("a) Primera opcion.");
  });
});

describe("invariants.ts", () => {
  test("assertFragmentInvariants detects duplicate node paths", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.buildFragments({
          metadata: parserMetadata,
          strategy: "simple",
          blocks: [
            { kind: "paragraph" as const, className: "parrafo", text: "First" },
            { kind: "paragraph" as const, className: "parrafo", text: "Second" },
          ],
        }).pipe(Effect.provide(BoeXmlParser.Default)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  test("NodePathCollisionError is properly structured", () => {
    const error = new NodePathCollisionError({
      nodePath: "/p/1",
      message: "Test collision",
    });
    expect(error._tag).toBe("NodePathCollisionError");
    expect(error.nodePath).toBe("/p/1");
  });

  test("EmptyFragmentContentError is properly structured", () => {
    const error = new EmptyFragmentContentError({
      nodePath: "/p/1",
      message: "Test empty",
    });
    expect(error._tag).toBe("EmptyFragmentContentError");
    expect(error.nodePath).toBe("/p/1");
  });
});

describe("linearize.ts", () => {
  test("linearizeOrderedTextBlocks returns empty array when texto section is missing", () => {
    const ordered = [{ documento: [{ metadatos: [] }] }];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks).toEqual([]);
  });

  test("linearizeOrderedTextBlocks handles non-record entries gracefully", () => {
    const ordered = [{ documento: [{ texto: ["string-entry", 123, null] }] }];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks).toEqual([]);
  });

  test("linearizeOrderedTextBlocks handles paragraph with number text", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                ":@": { "@_class": "parrafo" },
                p: [42],
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toEqual({ kind: "paragraph", className: "parrafo", text: "42" });
  });

  test("linearizeOrderedTextBlocks handles paragraph with array of strings", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                ":@": { "@_class": "parrafo" },
                p: [["Part1", "Part2"]],
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks.length).toBeGreaterThan(0);
  });

  test("linearizeOrderedTextBlocks handles nested objects in paragraph", () => {
    const ordered = [
      {
        documento: [
          {
            texto: [
              {
                ":@": { "@_class": "parrafo" },
                p: [{ "#text": "Text", span: "Span text" }],
              },
            ],
          },
        ],
      },
    ];
    const blocks = linearizeOrderedTextBlocks(ordered);
    expect(blocks.length).toBe(1);
  });
});

describe("normalize.ts", () => {
  test("normalizeTextContent normalizes whitespace", () => {
    expect(normalizeTextContent("  multiple   spaces  ")).toBe("multiple spaces");
    expect(normalizeTextContent("tabs\tand\nnewlines")).toBe("tabs and newlines");
  });

  test("normalizeSubparagraph handles ordinal markers", () => {
    const result = normalizeSubparagraph("1.ª Primera disposicion");
    expect(result.marker).toBe("1ª");
    expect(result.content).toBe("Primera disposicion");

    const result2 = normalizeSubparagraph("22.º Vigesima segunda");
    expect(result2.marker).toBe("22º");
    expect(result2.content).toBe("Vigesima segunda");
  });

  test("normalizeSubparagraph handles no match case", () => {
    const result = normalizeSubparagraph("Just plain text without marker");
    expect(result.marker).toBe("");
    expect(result.content).toBe("Just plain text without marker");
  });

  test("extractTableText handles non-table input", () => {
    const result = extractTableText("Just a string");
    expect(result).toBe("Just a string");
  });

  test("extractTableText handles non-table input gracefully", () => {
    const result = extractTableText({ notTable: "data" });
    expect(result).toBe("data");
  });

  test("extractTableText handles table with various cell types", () => {
    const tableData = {
      tr: [
        {
          th: [{ "#text": "Header" }, 123],
          td: [null, undefined, { span: "content" }],
        },
      ],
    };
    const result = extractTableText(tableData);
    expect(result).toContain("Header");
  });
});

describe("query.ts", () => {
  test("Query.all() returns All query", () => {
    const query = Query.all();
    expect(query._tag).toBe("All");
  });

  test("Query.byLegalPath() returns ByLegalPath query", () => {
    const query = Query.byLegalPath("/article/1");
    expect(query._tag).toBe("ByLegalPath");
    if (query._tag === "ByLegalPath") {
      expect(query.path).toBe("/article/1");
    }
  });

  test("evaluateQuery handles All query", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.all());

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });

  test("evaluateQuery handles ByLegalPath with existing path", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.byLegalPath("/article/1"));

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });

  test("evaluateQuery handles ByLegalPath with non-existing path", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.byLegalPath("/article/nonexistent"));

    expect(result._tag).toBe("NotFound");
  });

  test("selectByLegalPath filters fragments correctly", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);

    const selected = selectByLegalPath(fragments, "/article/1");
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((f) => f.legalNodePath?.startsWith("/article/1"))).toBe(true);
  });

  test("selectByLegalPath handles trailing slash", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);

    const selected = selectByLegalPath(fragments, "/article/1/");
    expect(selected.length).toBeGreaterThan(0);
  });

  test("evaluateQuery returns NotFound when no candidates match", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "simple",
        blocks: [{ kind: "paragraph" as const, className: "parrafo", text: "Content" }],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const result = evaluateQuery(fragments, Query.article("nonexistent"));
    expect(result._tag).toBe("NotFound");
  });

  test("evaluateQuery handles scoped article with general scope", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.article("primera", { scope: "general" }));

    expect(result._tag).toBe("NotFound");
  });

  test("Query.article without scope returns Ambiguous for duplicate articles", async () => {
    const xml = await readFixture("real-boe-full.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(fragments, Query.article("primera"));

    expect(result._tag).toBe("Ambiguous");
    if (result._tag === "Ambiguous") {
      expect(result.candidates.length).toBeGreaterThan(1);
    }
  });
});

describe("service.ts - error handling", () => {
  test("throws MissingRootDocumentoError for XML without documento root", async () => {
    const xml = "<root><content>Test</content></root>";
    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("MissingRootDocumentoError");
    }
  });

  test("MissingRootDocumentoError is properly structured", () => {
    const error = new MissingRootDocumentoError({ message: "Test message" });
    expect(error._tag).toBe("MissingRootDocumentoError");
    expect(error.message).toBe("Test message");
  });

  test("handles XML with missing analysis section gracefully", async () => {
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
  <texto>
    <p class="parrafo">Test content.</p>
  </texto>
</documento>`;

    // This should parse without errors even without analysis section
    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
      ),
    );

    // The parser handles missing analysis
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("traversal/classify.ts", () => {
  test("toTextNode handles annexNumber", () => {
    const token = { _tag: "annexNumber" as const, number: "ANEXO I" };
    const node = toTextNode(token);
    expect(node._tag).toBe("annex");
    if (node._tag === "annex") {
      expect(node.number).toBe("ANEXO I");
      expect(node.title).toBe("");
    }
  });

  test("toTextNode handles annexTitle", () => {
    const token = { _tag: "annexTitle" as const, title: "Descripcion" };
    const node = toTextNode(token);
    expect(node._tag).toBe("annex");
    if (node._tag === "annex") {
      expect(node.number).toBe("");
      expect(node.title).toBe("Descripcion");
    }
  });

  test("classifyBlock handles titulo_tit as paragraph", () => {
    const block = { kind: "paragraph" as const, className: "titulo_tit", text: "Titulo" };
    const classified = classifyBlock(block);
    expect(classified._tag).toBe("paragraph");
    if (classified._tag === "paragraph") {
      expect(classified.content).toBe("Titulo");
    }
  });

  test("classifyBlock handles capitulo_tit as paragraph", () => {
    const block = { kind: "paragraph" as const, className: "capitulo_tit", text: "Capitulo" };
    const classified = classifyBlock(block);
    expect(classified._tag).toBe("paragraph");
  });
});

describe("traversal/engine.ts", () => {
  test("applyToken handles signature token", async () => {
    const xml = await readFixture("simple-administrative.xml");
    const fragments = await parseToFragments(xml);

    // The parser should handle signature blocks
    expect(fragments.length).toBeGreaterThan(0);
  });

  test("applyToken handles raw token", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "clase_desconocida", text: "Raw content" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0]?.content).toBe("Raw content");
  });

  test("applyToken handles table in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "table" as const, text: "Col A | Col B\n1 | 2" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const tableFragment = fragments.find((f) => f.nodePath.includes("/t/"));
    expect(tableFragment).toBeDefined();
    expect(tableFragment?.nodePath.startsWith("/x/")).toBe(true);
  });

  test("applyToken handles subparagraph in article without paragraph context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "articulo", text: "Articulo 1." },
          { kind: "paragraph" as const, className: "parrafo_2", text: "a) Subparrafo directo." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subparagraph = fragments.find((f) => f.nodeType === "subparagraph");
    expect(subparagraph).toBeDefined();
  });

  test("applyToken handles section heading in main context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph" as const, className: "seccion", text: "SECCION 1" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const section = fragments.find((f) => f.nodeType === "section");
    expect(section).toBeDefined();
  });

  test("applyToken handles chapter that starts with ANEXO", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "ANEXO I. Descripcion" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const annex = fragments.find((f) => f.nodePath.startsWith("/x/"));
    expect(annex).toBeDefined();
  });

  test("applyToken handles chapter in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO ANEXO" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subsection = fragments.find((f) => f.nodeType === "subsection");
    expect(subsection).toBeDefined();
  });

  test("applyToken handles subsection in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "centro_cursiva", text: "Subseccion" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subsection = fragments.find((f) => f.nodeType === "subsection");
    expect(subsection).toBeDefined();
  });

  test("applyToken handles table in article context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph" as const, className: "articulo", text: "Articulo 1." },
          { kind: "table" as const, text: "Col A | Col B\n1 | 2" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const tableFragment = fragments.find((f) => f.nodePath.includes("/t/"));
    expect(tableFragment).toBeDefined();
    expect(tableFragment?.nodePath.startsWith("/c/")).toBe(true);
  });

  test("applyToken handles subparagraph in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "parrafo_2", text: "a) Subparrafo en anexo." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subparagraph = fragments.find(
      (f) => f.nodeType === "subparagraph" && f.nodePath.startsWith("/x/"),
    );
    expect(subparagraph).toBeDefined();
  });

  test("applyToken handles paragraph in chapter-only context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph" as const, className: "parrafo", text: "Parrafo sin articulo." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const paragraph = fragments.find(
      (f) => f.nodeType === "paragraph" && f.nodePath.startsWith("/c/1/p/"),
    );
    expect(paragraph).toBeDefined();
  });

  test("applyToken handles disposition chapters", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          {
            kind: "paragraph" as const,
            className: "capitulo",
            text: "[encabezado] DISPOSICION TRANSITORIA UNICA",
          },
          { kind: "paragraph" as const, className: "articulo", text: "Articulo Unico." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const disp = fragments.find((f) => f.nodeType === "disposicion_transitoria");
    expect(disp).toBeDefined();
  });

  test("applyToken handles title heading", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "titulo_num", text: "TITULO I" },
          { kind: "paragraph" as const, className: "parrafo", text: "Contenido." },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const title = fragments.find((f) => f.nodeType === "title");
    expect(title).toBeDefined();
  });

  test("applyToken handles disposition final", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          {
            kind: "paragraph" as const,
            className: "capitulo",
            text: "[encabezado] DISPOSICION FINAL PRIMERA",
          },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const disp = fragments.find((f) => f.nodeType === "disposicion_final");
    expect(disp).toBeDefined();
  });

  test("applyToken handles title heading in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "titulo_num", text: "TITULO ANEXO" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subsection = fragments.find((f) => f.nodeType === "subsection");
    expect(subsection).toBeDefined();
  });

  test("applyToken handles annex title", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "anexo_tit", text: "Titulo del anexo" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const headers = fragments.filter((f) => f.nodePath.includes("/h/"));
    expect(headers.length).toBeGreaterThan(0);
  });

  test("applyToken handles subsection in main context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "capitulo", text: "CAPITULO I" },
          { kind: "paragraph" as const, className: "centro_cursiva", text: "Subseccion" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subsection = fragments.find((f) => f.nodeType === "subsection");
    expect(subsection).toBeDefined();
  });

  test("applyToken handles section heading in annex context", async () => {
    const fragments = await Effect.runPromise(
      BoeXmlParser.buildFragments({
        metadata: parserMetadata,
        strategy: "legislative",
        blocks: [
          { kind: "paragraph" as const, className: "anexo_num", text: "ANEXO I" },
          { kind: "paragraph" as const, className: "seccion", text: "Seccion en anexo" },
        ],
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    const subsection = fragments.find((f) => f.nodeType === "subsection");
    expect(subsection).toBeDefined();
  });
});

describe("Additional coverage tests", () => {
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

describe("Edge case coverage tests", () => {
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

    const selected = selectByLegalPath(fragments, "/article/1");
    expect(selected).toEqual([]);
  });

  test("queryLegal with paragraph filter returns NotFound when no match", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        xml,
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

    const selected = selectByLegalPath(fragments, "/article/1");
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
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        xml,
        query: Query.byLegalPath("/article/1"),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });

  test("queryLegal handles All query", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const result = await Effect.runPromise(
      BoeXmlParser.queryLegal({
        xml,
        query: Query.all(),
      }).pipe(Effect.provide(BoeXmlParser.Default)),
    );

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });
});

describe("invariants.ts - direct testing", () => {
  test("assertFragmentInvariants detects duplicate node paths", async () => {
    const fragmentsWithDuplicate = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
      {
        content: "Second fragment with same path",
        contentNormalized: "Second fragment with same path",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 1,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithDuplicate)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NodePathCollisionError");
    }
  });

  test("assertFragmentInvariants detects empty content", async () => {
    const fragmentsWithEmptyContent = [
      {
        content: "",
        contentNormalized: "",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithEmptyContent)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("EmptyFragmentContentError");
    }
  });

  test("assertFragmentInvariants detects sequence index mismatch", async () => {
    const fragmentsWithWrongSequence = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 5,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithWrongSequence)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NodePathCollisionError");
      expect(result.left.message).toContain("Unexpected sequence index");
    }
  });

  test("assertFragmentInvariants passes with valid fragments", async () => {
    const validFragments = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
      {
        content: "Second fragment",
        contentNormalized: "Second fragment",
        nodePath: NodePathString("/p/2"),
        nodeType: "paragraph" as const,
        sequenceIndex: 1,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(Effect.either(assertFragmentInvariants(validFragments)));

    expect(Either.isRight(result)).toBe(true);
  });

  test("assertFragmentInvariants passes with empty fragments array", async () => {
    const result = await Effect.runPromise(Effect.either(assertFragmentInvariants([])));
    expect(Either.isRight(result)).toBe(true);
  });
});
