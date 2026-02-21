import { normalizeLegalPathSegment } from "./normalize";
import { parseLegalPath, renderLegalPath } from "./path-query";
import { type BoeFragment, type LegalNodePathString as LegalNodePath } from "./types";

export type DispositionScope =
  | "general"
  | "disposicion-adicional"
  | "disposicion-final"
  | "disposicion-transitoria"
  | "disposicion-derogatoria";

export type LegalQuery =
  | { readonly _tag: "All" }
  | { readonly _tag: "ByLegalPath"; readonly path: LegalNodePath | string }
  | {
      readonly _tag: "Article";
      readonly article: string;
      readonly paragraph?: number;
      readonly scope?: DispositionScope;
    }
  | {
      readonly _tag: "DispositionArticle";
      readonly disposition: Exclude<DispositionScope, "general">;
      readonly article: string;
      readonly paragraph?: number;
    };

export type LegalQueryResult =
  | {
      readonly _tag: "Match";
      readonly fragments: ReadonlyArray<BoeFragment>;
      readonly paths: ReadonlyArray<LegalNodePath>;
    }
  | {
      readonly _tag: "Ambiguous";
      readonly candidates: ReadonlyArray<{
        readonly basePath: LegalNodePath;
        readonly fragments: ReadonlyArray<BoeFragment>;
      }>;
    }
  | { readonly _tag: "NotFound" };

export const Query = {
  all: (): LegalQuery => ({ _tag: "All" }),
  byLegalPath: (path: LegalNodePath | string): LegalQuery => ({ _tag: "ByLegalPath", path }),
  article: (
    article: string,
    options?: { readonly paragraph?: number; readonly scope?: DispositionScope },
  ): LegalQuery => ({
    _tag: "Article",
    article,
    paragraph: options?.paragraph,
    scope: options?.scope,
  }),
  dispositionArticle: (
    disposition: Exclude<DispositionScope, "general">,
    article: string,
    options?: { readonly paragraph?: number },
  ): LegalQuery => ({
    _tag: "DispositionArticle",
    disposition,
    article,
    paragraph: options?.paragraph,
  }),
} as const;

export const selectByLegalPath = (
  fragments: ReadonlyArray<BoeFragment>,
  legalPath: LegalNodePath | string,
): ReadonlyArray<BoeFragment> => {
  const canonical = toCanonicalLegalPath(legalPath);
  return fragments.filter((fragment) => {
    if (fragment.legalNodePath === undefined) {
      return false;
    }

    const value = String(fragment.legalNodePath);
    return value === canonical || value.startsWith(`${canonical}/`);
  });
};

export const evaluateQuery = (
  fragments: ReadonlyArray<BoeFragment>,
  query: LegalQuery,
): LegalQueryResult => {
  switch (query._tag) {
    case "All": {
      const paths = uniqueLegalPaths(fragments);
      return {
        _tag: "Match",
        fragments,
        paths,
      };
    }
    case "ByLegalPath": {
      const selected = selectByLegalPath(fragments, query.path);
      if (selected.length === 0) {
        return { _tag: "NotFound" };
      }

      return {
        _tag: "Match",
        fragments: selected,
        paths: uniqueLegalPaths(selected),
      };
    }
    case "DispositionArticle": {
      const queryForScope: LegalQuery = {
        _tag: "Article",
        article: query.article,
        paragraph: query.paragraph,
        scope: query.disposition,
      };
      return evaluateQuery(fragments, queryForScope);
    }
    case "Article": {
      const articleKey = normalizeLegalToken(query.article);
      const explicitBasePath = toScopedArticlePath(articleKey, query.scope);
      const candidates =
        explicitBasePath !== undefined
          ? [explicitBasePath]
          : findArticleCandidates(fragments, articleKey);

      if (candidates.length === 0) {
        return { _tag: "NotFound" };
      }

      if (candidates.length > 1) {
        return {
          _tag: "Ambiguous",
          candidates: candidates.map((basePath) => ({
            basePath,
            fragments: withParagraphFilter(selectByLegalPath(fragments, basePath), query.paragraph),
          })),
        };
      }

      const basePath = candidates[0];
      if (basePath === undefined) {
        return { _tag: "NotFound" };
      }
      const selected = withParagraphFilter(selectByLegalPath(fragments, basePath), query.paragraph);
      if (selected.length === 0) {
        return { _tag: "NotFound" };
      }

      return {
        _tag: "Match",
        fragments: selected,
        paths: [basePath],
      };
    }
  }
};

const withParagraphFilter = (
  fragments: ReadonlyArray<BoeFragment>,
  paragraph: number | undefined,
): ReadonlyArray<BoeFragment> => {
  if (paragraph === undefined) {
    return fragments;
  }

  return fragments.filter((fragment) => {
    if (fragment.legalNodePath === undefined) {
      return false;
    }
    return String(fragment.legalNodePath).endsWith(`/p/${paragraph}`);
  });
};

const findArticleCandidates = (
  fragments: ReadonlyArray<BoeFragment>,
  articleKey: string,
): ReadonlyArray<LegalNodePath> => {
  const bases = new Set<LegalNodePath>();

  for (const fragment of fragments) {
    if (fragment.legalNodePath === undefined) {
      continue;
    }

    const base = articleBasePath(fragment.legalNodePath);
    if (base !== undefined && String(base).endsWith(`/article/${articleKey}`)) {
      bases.add(base);
    }
  }

  return [...bases];
};

const toScopedArticlePath = (
  articleKey: string,
  scope: DispositionScope | undefined,
): LegalNodePath | undefined => {
  if (scope === undefined) {
    return undefined;
  }

  const segments =
    scope === "general"
      ? [{ _tag: "article", value: articleKey } as const]
      : [{ _tag: "scope", value: scope } as const, { _tag: "article", value: articleKey } as const];

  return renderLegalPath({ segments });
};

const articleBasePath = (path: LegalNodePath): LegalNodePath | undefined => {
  const parsed = parseLegalPath(path);
  const scopeSegment = parsed.segments.find((segment) => segment._tag === "scope");
  const articleSegment = parsed.segments.find((segment) => segment._tag === "article");

  if (articleSegment === undefined) {
    return undefined;
  }

  const segments = scopeSegment === undefined ? [articleSegment] : [scopeSegment, articleSegment];

  return renderLegalPath({ segments });
};

const uniqueLegalPaths = (fragments: ReadonlyArray<BoeFragment>): ReadonlyArray<LegalNodePath> => {
  const set = new Set<LegalNodePath>();
  for (const fragment of fragments) {
    if (fragment.legalNodePath !== undefined) {
      set.add(fragment.legalNodePath);
    }
  }
  return [...set];
};

function normalizeLegalToken(raw: string): string {
  return normalizeLegalPathSegment(raw);
}

function toCanonicalLegalPath(path: LegalNodePath | string): string {
  return String(renderLegalPath(parseLegalPath(path)));
}
