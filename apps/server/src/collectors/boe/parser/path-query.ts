import { isDispositionPathScope } from "./legal-scope";
import { normalizeLegalPathSegment } from "./normalize";
import {
  LegalNodePathString,
  type CanonicalFragmentPathQuery,
  type FragmentPathQuery,
  type FragmentPathScope,
  type LegalPathAst,
  type LegalPathSegment,
  type PathMode,
  type PathModeTypeMap,
  FRAGMENT_PATH_SCOPE_MAP,
} from "./types";

type FragmentScopeEntry = (typeof FRAGMENT_PATH_SCOPE_MAP)[keyof typeof FRAGMENT_PATH_SCOPE_MAP];

const fragmentScopeEntries: ReadonlyArray<FragmentScopeEntry> =
  Object.values(FRAGMENT_PATH_SCOPE_MAP);

const fragmentPathScopes = new Set<FragmentPathScope>(
  fragmentScopeEntries.map((entry) => entry.segment),
);

export function isFragmentPathQuery(value: string): value is FragmentPathQuery {
  if (value === "/") {
    return true;
  }

  if (!value.startsWith("/")) {
    return false;
  }

  const trimmed = value.endsWith("/") ? value.slice(1, -1) : value.slice(1);
  if (trimmed.length === 0) {
    return false;
  }

  return isFragmentPathScope(trimmed);
}

export function toCanonicalFragmentPathQuery(query: FragmentPathQuery): CanonicalFragmentPathQuery {
  if (query === "/") {
    return "/";
  }

  const rawScope = query.slice(1).replace(/\/$/, "");
  if (!isFragmentPathScope(rawScope)) {
    throw new Error(`Invalid fragment path scope '${rawScope}'`);
  }

  return canonicalFragmentScopeQuery(rawScope);
}

export function canonicalFragmentScopeQuery(scope: FragmentPathScope): CanonicalFragmentPathQuery {
  const canonical = `/${scope}/`;
  if (!isCanonicalFragmentPathQuery(canonical)) {
    throw new Error(`Invalid canonical fragment scope '${scope}'`);
  }
  return canonical;
}

export function parseLegalPath(path: LegalNodePathString | string): LegalPathAst {
  const canonical = normalizeLegalPath(path);
  const parts = canonical.split("/").filter((segment) => segment.length > 0);
  const segments: Array<LegalPathSegment> = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      continue;
    }

    if (index === 0 && isDispositionPathScope(part)) {
      segments.push({ _tag: "scope", value: part });
      continue;
    }

    if (part === "article") {
      const articleValue = parts[index + 1];
      if (articleValue !== undefined) {
        segments.push({ _tag: "article", value: articleValue });
        index += 1;
        continue;
      }
    }

    if (part === "p") {
      const paragraphValue = parts[index + 1];
      if (paragraphValue !== undefined && /^\d+$/.test(paragraphValue)) {
        segments.push({ _tag: "paragraph", value: Number(paragraphValue) });
        index += 1;
        continue;
      }
    }

    segments.push({ _tag: "custom", value: part });
  }

  return { segments };
}

export function renderLegalPath(ast: LegalPathAst): LegalNodePathString {
  const renderedSegments: Array<string> = [];
  for (const segment of ast.segments) {
    switch (segment._tag) {
      case "scope":
        renderedSegments.push(segment.value);
        break;
      case "article": {
        const normalizedArticle = normalizeLegalPathSegment(segment.value);
        if (normalizedArticle.length > 0) {
          renderedSegments.push("article", normalizedArticle);
        }
        break;
      }
      case "paragraph":
        renderedSegments.push("p", String(segment.value));
        break;
      case "custom": {
        const normalizedCustom = normalizeLegalPathSegment(segment.value);
        if (normalizedCustom.length > 0) {
          renderedSegments.push(normalizedCustom);
        }
        break;
      }
    }
  }

  const rendered = renderedSegments.join("/");

  if (rendered.length === 0) {
    throw new Error("Cannot render empty legal path AST");
  }

  return LegalNodePathString(`/${rendered}`);
}

export function legalPath(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
): LegalNodePathString {
  const raw = interpolateTemplate(strings, values, (value) => {
    const normalized = normalizeLegalPathSegment(String(value));
    if (normalized.length === 0) {
      throw new Error(`Invalid empty legal path segment from '${String(value)}'`);
    }
    if (normalized.includes("/")) {
      throw new Error(`Illegal '/' in legal path segment '${normalized}'`);
    }
    return normalized;
  });

  return renderLegalPath(parseLegalPath(raw));
}

export function fragmentPath(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
): FragmentPathQuery {
  const raw = interpolateTemplate(strings, values, (value) => String(value).trim());
  if (!isFragmentPathQuery(raw)) {
    throw new Error(`Invalid fragment path query '${raw}'. Use '/', '/p', '/c', '/x', or '/t'.`);
  }
  return raw;
}

export function path<M extends "fragment">(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
): PathModeTypeMap[M];
export function path<M extends "legal" = "legal">(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
): PathModeTypeMap[M];
export function path(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
): FragmentPathQuery | LegalNodePathString {
  const raw = interpolateTemplate(strings, values, (value) => String(value).trim());
  if (isFragmentPathQuery(raw)) {
    return raw;
  }
  return legalPath(strings, ...values);
}

export function pathLiteral(
  mode: "fragment",
): (strings: TemplateStringsArray, ...values: ReadonlyArray<string | number>) => FragmentPathQuery;
export function pathLiteral(
  mode: "legal",
): (
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<string | number>
) => LegalNodePathString;
export function pathLiteral(mode: PathMode) {
  if (mode === "fragment") {
    return fragmentPath;
  }
  return legalPath;
}

export const pathBuilder = {
  fragment: fragmentPath,
  legal: legalPath,
  for: pathLiteral,
} as const;

function normalizeLegalPath(raw: string): string {
  if (!raw.startsWith("/")) {
    throw new Error(`Legal path must start with '/': '${raw}'`);
  }

  const segments = raw
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizeLegalPathSegment)
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new Error("Legal path must contain at least one segment");
  }

  return `/${segments.join("/")}`;
}

function isFragmentPathScope(value: string): value is FragmentPathScope {
  for (const scope of fragmentPathScopes) {
    if (scope === value) {
      return true;
    }
  }
  return false;
}

function isCanonicalFragmentPathQuery(value: string): value is CanonicalFragmentPathQuery {
  if (value === "/") {
    return true;
  }

  for (const entry of fragmentScopeEntries) {
    if (value === `/${entry.segment}/`) {
      return true;
    }
  }

  return false;
}

function interpolateTemplate(
  strings: TemplateStringsArray,
  values: ReadonlyArray<string | number>,
  mapValue: (value: string | number) => string,
): string {
  let result = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined) {
      result += mapValue(value);
    }
    result += strings[index + 1] ?? "";
  }
  return result.trim();
}
