import { Brand, Schema } from "effect";

import { LegalNodePathString, NodePathString } from "./types";

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

function assertAbsoluteSlashPath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`Path must start with '/': '${path}'`);
  }
  if (path.length === 1) {
    throw new Error("Root path '/' cannot be encoded as ltree");
  }
  if (path.endsWith("/")) {
    throw new Error(`Path must not end with '/': '${path}'`);
  }
  if (path.includes("//")) {
    throw new Error(`Path must not contain empty segments: '${path}'`);
  }
}

function slashPathToLtreeUnsafe(path: string): string {
  assertAbsoluteSlashPath(path);
  const labels = path
    .split("/")
    .slice(1)
    .map((segment) => {
      const hex = toHex(segment);
      return `s_${hex}`;
    });
  const value = labels.join(".");
  if (!ltreePattern.test(value)) {
    throw new Error(`Encoded ltree path is invalid: '${value}'`);
  }
  return value;
}

function ltreeToSlashPathUnsafe(path: string): string {
  if (!ltreePattern.test(path)) {
    throw new Error(`Invalid ltree path '${path}'`);
  }

  const segments = path.split(".").map((label) => {
    if (!label.startsWith("s_")) {
      throw new Error(`Unsupported ltree label '${label}'`);
    }
    const hex = label.slice(2);
    return fromHex(hex);
  });

  const result = `/${segments.join("/")}`;
  assertAbsoluteSlashPath(result);
  return result;
}

export function nodePathToLtree(path: NodePathString): LtreePathString {
  const ltree = slashPathToLtreeUnsafe(String(path));
  return LtreePathString(ltree);
}

export function legalNodePathToLtree(path: LegalNodePathString): LtreePathString {
  const ltree = slashPathToLtreeUnsafe(String(path));
  return LtreePathString(ltree);
}

export function ltreeToNodePath(path: LtreePathString): NodePathString {
  const slash = ltreeToSlashPathUnsafe(String(path));
  if (!nodePathPattern.test(slash)) {
    throw new Error(`Decoded path is not a valid structural node path: '${slash}'`);
  }
  return NodePathString(slash);
}

export function ltreeToLegalNodePath(path: LtreePathString): LegalNodePathString {
  const slash = ltreeToSlashPathUnsafe(String(path));
  return LegalNodePathString(slash);
}
