import { describe, expect, test } from "bun:test";

import { Effect, Either } from "effect";

import { BoeXmlParser } from "~/collectors/boe/parser";
import { Query } from "~/collectors/boe/parser/query";
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
    expect(pMarkdown.includes("<!-- Path: /c/1/a/1")).toBe(false);
  });
});
