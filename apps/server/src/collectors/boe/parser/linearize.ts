import { MalformedTextSectionError } from "./errors";
import { extractTableText, normalizeTextContent } from "./normalize";
import type { LinearBlock } from "./types";

export function linearizeOrderedTextBlocks(ordered: unknown): ReadonlyArray<LinearBlock> {
  const textoEntries = getTextoEntries(ordered);
  if (textoEntries.length === 0) {
    return [];
  }

  const blocks: Array<LinearBlock> = [];

  for (const entry of textoEntries) {
    if (!isRecord(entry)) {
      continue;
    }

    if (entry.p !== undefined) {
      const className = getClassName(entry);
      const text = normalizeTextContent(collectText(entry.p));
      if (text.length > 0) {
        blocks.push({ kind: "paragraph", className, text });
      }
      continue;
    }

    if (entry.table !== undefined) {
      const text = extractTableText(entry.table);
      if (text.length > 0) {
        blocks.push({ kind: "table", text });
      }
    }
  }

  return blocks;
}

function getTextoEntries(ordered: unknown): ReadonlyArray<unknown> {
  const rootEntries = asArray(ordered);

  for (const rootEntry of rootEntries) {
    if (!isRecord(rootEntry) || rootEntry.documento === undefined) {
      continue;
    }

    const documentoEntries = asArray(rootEntry.documento);
    for (const documentoEntry of documentoEntries) {
      if (!isRecord(documentoEntry) || documentoEntry.texto === undefined) {
        continue;
      }

      return asArray(documentoEntry.texto);
    }
  }

  return [];
}

export function assertTextoRoot(ordered: unknown): void {
  const hasRoot = getTextoEntries(ordered).length > 0;
  if (!hasRoot) {
    throw new MalformedTextSectionError({
      message: "Missing <texto> section in BOE XML",
    });
  }
}

function getClassName(entry: Record<string, unknown>): string {
  const attrs = entry[":@"];
  if (!isRecord(attrs)) {
    return "";
  }

  const classValue = attrs["@_class"];
  return typeof classValue === "string" ? classValue : "";
}

function collectText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (typeof input === "number") {
    return String(input);
  }

  if (Array.isArray(input)) {
    return input.map(collectText).join(" ");
  }

  if (!isRecord(input)) {
    return "";
  }

  const parts: Array<string> = [];

  if (typeof input["#text"] === "string" || typeof input["#text"] === "number") {
    parts.push(String(input["#text"]));
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === "#text" || key === ":@") {
      continue;
    }
    parts.push(collectText(value));
  }

  return parts.join(" ").trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asArray = (value: unknown): ReadonlyArray<unknown> => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};
