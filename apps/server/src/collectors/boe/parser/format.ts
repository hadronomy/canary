import { remark } from "remark";

import type {
  BoeFragment,
  CanonicalFragmentPathQuery,
  FragmentPathQuery,
  FragmentPathScope,
} from "./types";
import { MarkdownString } from "./types";

const FRAGMENT_PATH_SCOPES = [
  "p",
  "c",
  "x",
  "t",
] as const satisfies ReadonlyArray<FragmentPathScope>;

const markdownProcessor = remark();
type RemarkRoot = Parameters<typeof markdownProcessor.stringify>[0];
type RemarkRootContent = RemarkRoot extends { children: ReadonlyArray<infer Child> }
  ? Child
  : never;
type RemarkText = Extract<RemarkRootContent, { type: "text" }>;
type RemarkHeading = Extract<RemarkRootContent, { type: "heading" }>;
type RemarkParagraph = Extract<RemarkRootContent, { type: "paragraph" }>;
type RemarkListItem = Extract<RemarkRootContent, { type: "listItem" }>;
type RemarkList = Extract<RemarkRootContent, { type: "list" }>;
type RemarkThematicBreak = Extract<RemarkRootContent, { type: "thematicBreak" }>;
type RemarkHtml = Extract<RemarkRootContent, { type: "html" }>;

export const isFragmentPathQuery = (value: string): value is FragmentPathQuery => {
  if (value === "/") {
    return true;
  }

  return FRAGMENT_PATH_SCOPES.some((scope) => value === `/${scope}` || value === `/${scope}/`);
};

type CanonicalizePathQuery<Q extends FragmentPathQuery> = Q extends "/"
  ? "/"
  : Q extends `/${FragmentPathScope}/`
    ? Q
    : `${Q}/`;

export function normalizeFragmentPathQuery<Q extends FragmentPathQuery>(
  query: Q,
): CanonicalizePathQuery<Q> {
  if (query === "/") {
    return "/" as CanonicalizePathQuery<Q>;
  }

  if (query.endsWith("/")) {
    return query as CanonicalizePathQuery<Q>;
  }

  return `${query}/` as CanonicalizePathQuery<Q>;
}

export const selectFragmentsByPathQuery = (
  fragments: ReadonlyArray<BoeFragment>,
  query: FragmentPathQuery,
): ReadonlyArray<BoeFragment> => {
  const canonical = normalizeFragmentPathQuery(query) as CanonicalFragmentPathQuery;
  if (canonical === "/") {
    return fragments;
  }

  return fragments.filter((fragment) => fragment.nodePath.startsWith(canonical));
};

export const formatFragmentsAsMarkdown = (
  fragments: ReadonlyArray<BoeFragment>,
  query: FragmentPathQuery,
): MarkdownString => {
  const canonical = normalizeFragmentPathQuery(query) as CanonicalFragmentPathQuery;
  const selected = selectFragmentsByPathQuery(fragments, canonical);
  const metadata = selected[0]?.metadata ?? fragments[0]?.metadata;

  const children: Array<RemarkRootContent> = [];

  const title = metadata?.title ?? "Documento BOE";
  children.push(heading(1, title));

  if (metadata !== undefined) {
    children.push(
      summaryList([
        `Identificador: ${metadata.identifier}`,
        `Rango: ${metadata.documentType}`,
        `Departamento: ${metadata.department}`,
        `Publicación: ${metadata.publicationDate}`,
        `ELI: ${metadata.eliUrl}`,
        `Consulta: ${canonical}`,
        `Fragmentos: ${selected.length}`,
      ]),
    );
  } else {
    children.push(paragraph(`Consulta: ${canonical} · Fragmentos: ${selected.length}`));
  }

  children.push(hr());

  if (selected.length === 0) {
    children.push(paragraph("No fragments found for the selected path."));
  }

  const openNodes: Array<{
    readonly path: string;
    readonly sequenceIndex: number;
    readonly nodeType: string;
  }> = [];

  for (const [index, fragment] of selected.entries()) {
    const startComment = `Path: ${fragment.nodePath} · Seq: ${fragment.sequenceIndex} · Type: ${fragment.nodeType}`;

    const structuredHeading = toStructuredHeading(fragment);
    if (structuredHeading !== undefined) {
      children.push(heading(structuredHeading.depth, structuredHeading.title));
      children.push(comment(startComment));
      if (fragment.content !== structuredHeading.title) {
        children.push(paragraph(fragment.content));
      }
    } else {
      const content =
        fragment.nodeType === "subparagraph" &&
        fragment.nodeNumber !== undefined &&
        fragment.nodeNumber.length > 0
          ? `${fragment.nodeNumber}) ${fragment.content}`
          : fragment.content;

      children.push(comment(startComment));
      children.push(paragraph(content));
    }

    openNodes.push({
      path: String(fragment.nodePath),
      sequenceIndex: fragment.sequenceIndex,
      nodeType: fragment.nodeType,
    });

    const next = selected[index + 1];
    closeEndedNodes(openNodes, next?.nodePath, children);
  }

  const ast = {
    type: "root",
    children,
  } satisfies RemarkRoot;

  return MarkdownString(markdownProcessor.stringify(ast));
};

const toStructuredHeading = (
  fragment: BoeFragment,
): { readonly depth: 2 | 3 | 4; readonly title: string } | undefined => {
  switch (fragment.nodeType) {
    case "title":
      return {
        depth: 2,
        title: fragment.nodeTitle ?? fragment.content,
      };
    case "chapter":
    case "disposicion_final":
    case "disposicion_transitoria":
      return {
        depth: 2,
        title: fragment.nodeTitle ?? fragment.content,
      };
    case "article": {
      const number = fragment.nodeNumber ? `Artículo ${fragment.nodeNumber}` : "Artículo";
      const suffix =
        fragment.nodeTitle && fragment.nodeTitle.length > 0 ? ` — ${fragment.nodeTitle}` : "";
      return {
        depth: 3,
        title: `${number}${suffix}`,
      };
    }
    case "annex":
      return {
        depth: fragment.nodePath.includes("/h/") ? 3 : 2,
        title: fragment.nodeNumber ?? fragment.nodeTitle ?? fragment.content,
      };
    case "section":
      return {
        depth: 4,
        title: fragment.nodeTitle ?? fragment.content,
      };
    case "subsection":
      return {
        depth: 4,
        title: fragment.nodeTitle ?? fragment.content,
      };
    default:
      return undefined;
  }
};

const text = (value: string): RemarkText => ({
  type: "text",
  value,
});

const heading = (depth: 1 | 2 | 3 | 4 | 5 | 6, value: string): RemarkHeading => ({
  type: "heading",
  depth,
  children: [text(value)],
});

const paragraph = (value: string): RemarkParagraph => ({
  type: "paragraph",
  children: [text(value)],
});

const listItem = (value: string): RemarkListItem => ({
  type: "listItem",
  spread: false,
  children: [paragraph(value)],
});

const summaryList = (values: ReadonlyArray<string>): RemarkList => ({
  type: "list",
  ordered: false,
  spread: false,
  children: values.map(listItem),
});

const hr = (): RemarkThematicBreak => ({
  type: "thematicBreak",
});

const comment = (value: string): RemarkHtml => ({
  type: "html",
  value: `<!-- ${value} -->`,
});

const closeEndedNodes = (
  openNodes: Array<{
    readonly path: string;
    readonly sequenceIndex: number;
    readonly nodeType: string;
  }>,
  nextPath: string | undefined,
  children: Array<RemarkRootContent>,
): void => {
  while (openNodes.length > 0) {
    const current = openNodes[openNodes.length - 1];
    if (current === undefined) {
      return;
    }
    if (nextPath !== undefined && isDescendant(nextPath, current.path)) {
      return;
    }

    const finished = openNodes.pop();
    if (finished !== undefined) {
      children.push(
        comment(
          `End Path: ${finished.path} · Seq: ${finished.sequenceIndex} · Type: ${finished.nodeType}`,
        ),
      );
    }
  }
};

const isDescendant = (candidatePath: string, parentPath: string): boolean => {
  return candidatePath.startsWith(`${parentPath}/`);
};
