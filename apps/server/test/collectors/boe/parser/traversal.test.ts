import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { BoeXmlParser } from "~/collectors/boe/parser";
import { classifyBlock, toTextNode } from "~/collectors/boe/parser/traversal";

import {
  boeParserMetadata as parserMetadata,
  parseBoeFragments as parseToFragments,
  readBoeFixture as readFixture,
} from "../common";

describe("Parser traversal classification", () => {
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

describe("Parser traversal engine", () => {
  test("applyToken handles signature token", async () => {
    const xml = await readFixture("simple-administrative.xml");
    const fragments = await parseToFragments(xml);
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
