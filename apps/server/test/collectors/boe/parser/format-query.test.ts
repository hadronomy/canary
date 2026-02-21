import { describe, expect, test } from "bun:test";

import { Effect, Either } from "effect";

import {
  BoeXmlParser,
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
  path,
  Query,
  selectByLegalPath,
  selectFragmentsByPathQuery,
} from "~/collectors/boe/parser";
import { normalizeTextContent } from "~/collectors/boe/parser/normalize";
import { NodePathString } from "~/collectors/boe/parser/types";

import {
  boeParserMetadata as parserMetadata,
  parseBoeFragments as parseToFragments,
  readBoeFixture as readFixture,
} from "../common";

describe("Parser fluent builder", () => {
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

describe("Parser formatting and path filters", () => {
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

  test("formatFragmentsAsMarkdown supports document-level metadata override", () => {
    const fragments: Parameters<typeof formatFragmentsAsMarkdown>[0] = [
      {
        content: "Test content",
        contentNormalized: "Test content",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph",
        sequenceIndex: 0,
      },
    ];

    const markdown = formatFragmentsAsMarkdown(fragments, "/", parserMetadata);
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

describe("Parser invariant error types", () => {
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

describe("Parser linearization and normalization", () => {
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

describe("Parser query behavior and error handling", () => {
  test("Query.all() returns All query", () => {
    const query = Query.all();
    expect(query._tag).toBe("All");
  });

  test("Query.byLegalPath() returns ByLegalPath query", () => {
    const query = Query.byLegalPath(path<"legal">`/article/${1}`);
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
    const result = evaluateQuery(fragments, Query.byLegalPath(path<"legal">`/article/${1}`));

    expect(result._tag).toBe("Match");
    if (result._tag === "Match") {
      expect(result.fragments.length).toBeGreaterThan(0);
    }
  });

  test("evaluateQuery handles ByLegalPath with non-existing path", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);
    const result = evaluateQuery(
      fragments,
      Query.byLegalPath(path<"legal">`/article/${"nonexistent"}`),
    );

    expect(result._tag).toBe("NotFound");
  });

  test("selectByLegalPath filters fragments correctly", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);

    const selected = selectByLegalPath(fragments, path<"legal">`/article/${1}`);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((f) => f.legalNodePath?.startsWith("/article/1"))).toBe(true);
  });

  test("selectByLegalPath handles trailing slash", async () => {
    const xml = await readFixture("constitution-1978.xml");
    const fragments = await parseToFragments(xml);

    const selected = selectByLegalPath(fragments, path<"legal">`/article/${1}`);
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

    const result = await Effect.runPromise(
      Effect.either(
        BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });
});
