import type {
  NormalizedArticleHeader,
  NormalizedChapterHeader,
  NormalizedSubparagraph,
} from "./types";

const articlePatterns = [
  /\[?precepto\]?\s*(Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Disposición\s+transitoria\s+única)\.?\s*(.*)?/i,
  /Art\.?\s*(?:ículo\s*)?(\d+[\s.]?º?)(?:\s*[.:]\s*(.+))?/i,
];

export const normalizeTextContent = (text: string): string => {
  return text.replace(/\s+/g, " ").trim();
};

export function normalizeChapterHeader(text: string): NormalizedChapterHeader {
  const isSpecial = text.includes("[encabezado]");
  return {
    title: normalizeTextContent(text.replace(/^\[encabezado\]/i, "")),
    isSpecial,
  };
}

export function normalizeArticleHeader(text: string): NormalizedArticleHeader {
  const cleaned = normalizeTextContent(text);
  for (const pattern of articlePatterns) {
    const match = cleaned.match(pattern);
    if (match !== null) {
      return {
        number: normalizeTextContent(match[1] ?? cleaned),
        title: normalizeTextContent(match[2] ?? ""),
      };
    }
  }

  return {
    number: cleaned,
    title: "",
  };
}

export function normalizeSubparagraph(text: string): NormalizedSubparagraph {
  const cleaned = normalizeTextContent(text);
  const ordinalMatch = cleaned.match(/^(\d+)\.\s*([ªº])\s*(.*)$/i);
  if (ordinalMatch !== null) {
    return {
      marker: normalizeTextContent(`${ordinalMatch[1] ?? ""}${ordinalMatch[2] ?? ""}`),
      content: normalizeTextContent(ordinalMatch[3] ?? ""),
    };
  }

  const match = cleaned.match(/^([a-z]|\d+)[.)]\s*(.*)$/i);
  if (match === null) {
    return {
      marker: "",
      content: cleaned,
    };
  }

  return {
    marker: normalizeTextContent(match[1] ?? ""),
    content: normalizeTextContent(match[2] ?? ""),
  };
}

export function extractTableText(input: unknown): string {
  const rows = collectRows(input);
  if (rows.length > 0) {
    return rows.join("\n");
  }

  return normalizeTextContent(collectText(input));
}

function collectRows(input: unknown): Array<string> {
  const rows: Array<string> = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    const tr = value.tr;
    if (tr !== undefined) {
      const trEntries = asArray(tr);
      for (const trEntry of trEntries) {
        if (!isRecord(trEntry)) {
          continue;
        }

        const cells = [
          ...asArray(trEntry.th).map((cell) => normalizeTextContent(collectText(cell))),
          ...asArray(trEntry.td).map((cell) => normalizeTextContent(collectText(cell))),
        ].filter((cell) => cell.length > 0);

        if (cells.length > 0) {
          rows.push(cells.join(" | "));
        }
      }
    }

    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };

  visit(input);

  return rows;
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

  const textParts: Array<string> = [];

  if (typeof input["#text"] === "string" || typeof input["#text"] === "number") {
    textParts.push(String(input["#text"]));
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === "#text" || key === ":@") {
      continue;
    }
    textParts.push(collectText(value));
  }

  return textParts.join(" ").trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asArray = (value: unknown): ReadonlyArray<unknown> => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};
