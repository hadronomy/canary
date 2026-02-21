import { legalPathAstToLtree, nodePathSegmentsToLtree, type LtreePathString } from "./ltree-path";
import { toCanonicalFragmentPathQuery } from "./path-query";
import { parseLegalPath } from "./path-query";
import type {
  BoeAstDocument,
  BoeAstNode,
  CanonicalFragmentPathQuery,
  FragmentPathQuery,
} from "./types";

export interface AstNodePaths {
  readonly nodePathLtree: LtreePathString;
  readonly legalNodePathLtree?: LtreePathString;
}

export function astNodePaths(node: BoeAstNode): AstNodePaths {
  const legalPathAst =
    node.legalPathAst ??
    (node.legalNodePath === undefined ? undefined : parseLegalPath(node.legalNodePath));

  return {
    nodePathLtree: nodePathSegmentsToLtree(node.nodePathSegments),
    legalNodePathLtree: legalPathAst === undefined ? undefined : legalPathAstToLtree(legalPathAst),
  };
}

export function selectAstByScope(
  ast: BoeAstDocument,
  query: FragmentPathQuery,
): ReadonlyArray<BoeAstNode> {
  const canonical = toCanonicalFragmentPathQuery(query);
  return selectAstByCanonicalScope(ast, canonical);
}

export function selectAstByCanonicalScope(
  ast: BoeAstDocument,
  query: CanonicalFragmentPathQuery,
): ReadonlyArray<BoeAstNode> {
  const ids = ast.indexes.byFragmentScope.get(query);
  if (ids === undefined) {
    return [];
  }

  return ids
    .map((id) => ast.nodeById.get(id))
    .filter((node): node is BoeAstNode => node !== undefined)
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
}
