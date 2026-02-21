import { describe, expect, test } from "bun:test";

import {
  astNodePaths,
  path,
  pathBuilder,
  selectAstByCanonicalScope,
  selectAstByScope,
} from "~/collectors/boe/parser";

import { parseBoe, readBoeFixture } from "../common";

describe("parser AST contracts", () => {
  test("parse returns AST aligned with fragment projections", async () => {
    const xml = await readBoeFixture("constitution-1978.xml");
    const document = await parseBoe(xml);

    expect(document.ast.nodes.length).toBe(document.fragments.length);
    expect(document.ast.nodeById.size).toBe(document.ast.nodes.length);

    const first = document.ast.nodes[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      const projection = document.fragments[first.sequenceIndex];
      expect(projection).toBeDefined();
      expect(projection?.nodePath).toBe(first.nodePath);
      expect(projection?.content).toBe(first.content);
      expect(projection?.nodeType).toBe(first.nodeType);
    }
  });

  test("AST node IDs are stable across repeated parses", async () => {
    const xml = await readBoeFixture("real-boe-full.xml");
    const first = await parseBoe(xml);
    const second = await parseBoe(xml);

    expect(first.ast.nodes.map((node) => node.id)).toEqual(second.ast.nodes.map((node) => node.id));
    const sampleId = first.ast.nodes[0]?.id;
    expect(sampleId).toBeDefined();
    if (sampleId !== undefined) {
      expect(String(sampleId)).toMatch(/^node_[0-9a-f]{16}$/);
    }
  });

  test("scope indexes match direct scope selectors", async () => {
    const xml = await readBoeFixture("real-boe-full.xml");
    const document = await parseBoe(xml);

    const byScope = selectAstByScope(document.ast, pathBuilder.fragment`/c`);
    const byCanonical = selectAstByCanonicalScope(document.ast, "/c/");

    expect(byScope.map((node) => node.id)).toEqual(byCanonical.map((node) => node.id));
  });

  test("ltree derivation is available directly from AST nodes", async () => {
    const xml = await readBoeFixture("constitution-1978.xml");
    const document = await parseBoe(xml);
    const node = document.ast.nodes.find((candidate) => candidate.legalNodePath !== undefined);

    expect(node).toBeDefined();
    if (node === undefined) {
      return;
    }

    const paths = astNodePaths(node);
    expect(String(paths.nodePathLtree)).toContain("n_");
    expect(paths.legalNodePathLtree).toBeDefined();
  });

  test("explicit path builders and generic path facade remain equivalent", () => {
    const fragmentFromBuilder = pathBuilder.fragment`/p`;
    const fragmentFromFacade = path<"fragment">`/p`;
    const legalFromBuilder = pathBuilder.legal`/article/${38}`;
    const legalFromFacade = path<"legal">`/article/${38}`;

    expect(fragmentFromBuilder).toBe(fragmentFromFacade);
    expect(legalFromBuilder).toBe(legalFromFacade);
  });
});
