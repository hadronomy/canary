import { Brand, Schema } from "effect";

import { isDispositionPathScope } from "./legal-scope";
import { parseLegalPath, renderLegalPath } from "./path-query";
import {
  LegalNodePathString,
  NodePathString,
  type LegalPathAst,
  type LegalPathSegment,
  type NodePath,
  type NodePathSegment,
  type NodePathSegmentTag,
} from "./types";

const ltreePattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const nodePathPattern = /^\/(c|a|p|sp|x|t|s|h)\/\d+(?:\/(c|a|p|sp|x|t|s|h)\/\d+)*$/;

export type LtreePathString = string & Brand.Brand<"LtreePathString">;
export const LtreePathString = Brand.nominal<LtreePathString>();
export const LtreePathStringSchema = Schema.String.pipe(
  Schema.pattern(ltreePattern),
  Schema.fromBrand(LtreePathString),
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const nodeTagToShort: Readonly<Record<NodePathSegmentTag, string>> = {
  chapter: "c",
  article: "a",
  paragraph: "p",
  subparagraph: "sp",
  annex: "x",
  table: "t",
  section: "s",
  header: "h",
};

const shortToNodeTag: Readonly<Record<string, NodePathSegmentTag>> = {
  c: "chapter",
  a: "article",
  p: "paragraph",
  sp: "subparagraph",
  x: "annex",
  t: "table",
  s: "section",
  h: "header",
};

function toHex(value: string): string {
  return Array.from(encoder.encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): string {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) {
    throw new Error(`Invalid hex segment '${hex}'`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex segment '${hex}'`);
    }
    bytes[index / 2] = byte;
  }
  return decoder.decode(bytes);
}

export function nodePathToLtree(path: NodePathString): LtreePathString {
  return nodePathSegmentsToLtree(parseNodePath(path));
}

export function legalNodePathToLtree(path: LegalNodePathString): LtreePathString {
  return legalPathAstToLtree(parseLegalPath(path));
}

export function ltreeToNodePath(path: LtreePathString): NodePathString {
  return renderNodePath(ltreeToNodePathSegments(path));
}

export function ltreeToLegalNodePath(path: LtreePathString): LegalNodePathString {
  return renderLegalPath(ltreeToLegalPathAst(path));
}

export function nodePathSegmentsToLtree(path: NodePath): LtreePathString {
  if (path.length === 0) {
    throw new Error("NodePath cannot be empty");
  }

  const labels = path.map(
    (segment) => `n_${nodeTagToShort[segment._tag]}_${String(segment.index)}`,
  );
  return toLtreePath(labels);
}

export function legalPathAstToLtree(ast: LegalPathAst): LtreePathString {
  if (ast.segments.length === 0) {
    throw new Error("LegalPathAst cannot be empty");
  }

  const labels = ast.segments.map(encodeLegalSegmentLabel);
  return toLtreePath(labels);
}

export function ltreeToNodePathSegments(path: LtreePathString): ReadonlyArray<NodePathSegment> {
  const labels = parseLtreeLabels(path);
  return labels.map(decodeNodeSegmentLabel);
}

export function ltreeToLegalPathAst(path: LtreePathString): LegalPathAst {
  const labels = parseLtreeLabels(path);
  return {
    segments: labels.map(decodeLegalSegmentLabel),
  };
}

function parseNodePath(path: NodePathString): ReadonlyArray<NodePathSegment> {
  const raw = String(path);
  if (!nodePathPattern.test(raw)) {
    throw new Error(`Invalid structural node path '${raw}'`);
  }

  const parts = raw.slice(1).split("/");
  const segments: Array<NodePathSegment> = [];
  for (let index = 0; index < parts.length; index += 2) {
    const shortTag = parts[index];
    const segmentIndex = parts[index + 1];
    if (shortTag === undefined || segmentIndex === undefined) {
      throw new Error(`Invalid structural node path '${raw}'`);
    }

    const tag = shortToNodeTag[shortTag];
    if (tag === undefined) {
      throw new Error(`Unknown structural node tag '${shortTag}'`);
    }

    const parsedIndex = Number.parseInt(segmentIndex, 10);
    if (!Number.isInteger(parsedIndex) || parsedIndex <= 0) {
      throw new Error(`Invalid structural node index '${segmentIndex}'`);
    }

    segments.push({ _tag: tag, index: parsedIndex });
  }

  return segments;
}

function renderNodePath(path: ReadonlyArray<NodePathSegment>): NodePathString {
  if (path.length === 0) {
    throw new Error("NodePath cannot be empty");
  }

  const rendered = `/${path
    .map((segment) => `${nodeTagToShort[segment._tag]}/${String(segment.index)}`)
    .join("/")}`;

  if (!nodePathPattern.test(rendered)) {
    throw new Error(`Decoded path is not a valid structural node path: '${rendered}'`);
  }

  return NodePathString(rendered);
}

function encodeLegalSegmentLabel(segment: LegalPathSegment): string {
  switch (segment._tag) {
    case "scope":
      return `ls_${segment.value.replaceAll("-", "_")}`;
    case "article":
      return `la_${toHex(segment.value)}`;
    case "paragraph":
      return `lp_${String(segment.value)}`;
    case "custom":
      return `lc_${toHex(segment.value)}`;
  }
}

function decodeLegalSegmentLabel(label: string): LegalPathSegment {
  if (label.startsWith("ls_")) {
    const raw = label.slice(3).replaceAll("_", "-");
    if (!isDispositionPathScope(raw)) {
      throw new Error(`Unsupported legal scope '${raw}'`);
    }
    return { _tag: "scope", value: raw };
  }

  if (label.startsWith("la_")) {
    const value = fromHex(label.slice(3));
    if (value.length === 0) {
      throw new Error("Article segment cannot be empty");
    }
    return { _tag: "article", value };
  }

  if (label.startsWith("lp_")) {
    const raw = label.slice(3);
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid paragraph segment '${raw}'`);
    }
    return { _tag: "paragraph", value };
  }

  if (label.startsWith("lc_")) {
    return { _tag: "custom", value: fromHex(label.slice(3)) };
  }

  throw new Error(`Unsupported legal ltree label '${label}'`);
}

function decodeNodeSegmentLabel(label: string): NodePathSegment {
  const match = /^n_([a-z]+)_(\d+)$/.exec(label);
  if (match === null) {
    throw new Error(`Unsupported structural ltree label '${label}'`);
  }

  const [, shortTag, indexText] = match;
  if (shortTag === undefined || indexText === undefined) {
    throw new Error(`Unsupported structural ltree label '${label}'`);
  }
  const tag = shortToNodeTag[shortTag];
  if (tag === undefined) {
    throw new Error(`Unsupported structural ltree node tag '${shortTag}'`);
  }

  const index = Number.parseInt(indexText, 10);
  if (!Number.isInteger(index) || index <= 0) {
    throw new Error(`Invalid structural ltree index '${indexText}'`);
  }

  return { _tag: tag, index };
}

function parseLtreeLabels(path: LtreePathString): ReadonlyArray<string> {
  const raw = String(path);
  if (!ltreePattern.test(raw)) {
    throw new Error(`Invalid ltree path '${raw}'`);
  }

  const labels = raw.split(".").filter((label) => label.length > 0);
  if (labels.length === 0) {
    throw new Error(`Invalid ltree path '${raw}'`);
  }

  return labels;
}

function toLtreePath(labels: ReadonlyArray<string>): LtreePathString {
  const value = labels.join(".");
  if (!ltreePattern.test(value)) {
    throw new Error(`Encoded ltree path is invalid: '${value}'`);
  }
  return LtreePathString(value);
}
