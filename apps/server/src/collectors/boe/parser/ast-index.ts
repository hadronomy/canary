import { canonicalFragmentScopeQuery } from "./path-query";
import type {
  AstNodeId,
  BoeAstIndexes,
  BoeAstNode,
  CanonicalFragmentPathQuery,
  FragmentPathScope,
  NodeKind,
  NodePathSegment,
} from "./types";
import { FRAGMENT_PATH_SCOPE_MAP } from "./types";

type FragmentScopeEntry = (typeof FRAGMENT_PATH_SCOPE_MAP)[keyof typeof FRAGMENT_PATH_SCOPE_MAP];
const FRAGMENT_SCOPE_ENTRIES: ReadonlyArray<FragmentScopeEntry> =
  Object.values(FRAGMENT_PATH_SCOPE_MAP);

export function buildAstIndexes(nodes: ReadonlyArray<BoeAstNode>): BoeAstIndexes {
  return {
    byNodePath: buildByNodePathIndex(nodes),
    byLegalPath: buildByLegalPathIndex(nodes),
    byFragmentScope: buildByFragmentScopeIndex(nodes),
  };
}

function buildByNodePathIndex(nodes: ReadonlyArray<BoeAstNode>): BoeAstIndexes["byNodePath"] {
  const map = new Map<BoeAstNode["nodePath"], Array<AstNodeId>>();
  for (const node of nodes) {
    const bucket = map.get(node.nodePath);
    if (bucket === undefined) {
      map.set(node.nodePath, [node.id]);
    } else {
      bucket.push(node.id);
    }
  }
  return map;
}

function buildByLegalPathIndex(nodes: ReadonlyArray<BoeAstNode>): BoeAstIndexes["byLegalPath"] {
  const map = new Map<NonNullable<BoeAstNode["legalNodePath"]>, Array<AstNodeId>>();
  for (const node of nodes) {
    if (node.legalNodePath === undefined) {
      continue;
    }
    const bucket = map.get(node.legalNodePath);
    if (bucket === undefined) {
      map.set(node.legalNodePath, [node.id]);
    } else {
      bucket.push(node.id);
    }
  }
  return map;
}

function buildByFragmentScopeIndex(
  nodes: ReadonlyArray<BoeAstNode>,
): BoeAstIndexes["byFragmentScope"] {
  const map = new Map<CanonicalFragmentPathQuery, Array<AstNodeId>>();
  map.set("/", []);
  for (const entry of FRAGMENT_SCOPE_ENTRIES) {
    map.set(canonicalFragmentScopeQuery(entry.segment), []);
  }

  for (const node of nodes) {
    map.get("/")?.push(node.id);
    const scope = toCanonicalScopeFromSegments(node.nodePathSegments);
    if (scope !== undefined) {
      map.get(scope)?.push(node.id);
    }
  }

  return map;
}

function toCanonicalScopeFromSegments(
  segments: ReadonlyArray<NodePathSegment>,
): CanonicalFragmentPathQuery | undefined {
  const first = segments[0];
  if (first === undefined) {
    return undefined;
  }
  const scope = toScopeFromRootTag(first._tag);
  return scope === undefined ? undefined : canonicalFragmentScopeQuery(scope);
}

function toScopeFromRootTag(tag: NodePathSegment["_tag"]): FragmentPathScope | undefined {
  const rootKind = ROOT_TAG_KIND_MAP[tag];
  if (rootKind === undefined) {
    return undefined;
  }

  for (const entry of FRAGMENT_SCOPE_ENTRIES) {
    if (includesNodeKind(entry.nodeTypes, rootKind)) {
      return entry.segment;
    }
  }

  return undefined;
}

const ROOT_TAG_KIND_MAP: Partial<Record<NodePathSegment["_tag"], NodeKind>> = {
  paragraph: "preambulo",
  chapter: "chapter",
  annex: "annex",
  table: "table",
};

function includesNodeKind(nodeTypes: ReadonlyArray<NodeKind>, nodeKind: NodeKind): boolean {
  return nodeTypes.includes(nodeKind);
}
