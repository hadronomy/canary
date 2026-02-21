import { createAstNodeId } from "../ast-id";
import { buildAstIndexes } from "../ast-index";
import { parseLegalPath } from "../path-query";
import type { AstNodeId, BoeAstDocument, BoeAstNode, BoeFragment } from "../types";
import { renderPath } from "./path-allocator";
import type { FragmentSeed } from "./types";

export const finalizeFragments = (seeds: ReadonlyArray<FragmentSeed>): ReadonlyArray<BoeFragment> =>
  finalizeAstDocument(seeds).fragments;

export function finalizeAstDocument(seeds: ReadonlyArray<FragmentSeed>): {
  readonly ast: BoeAstDocument;
  readonly fragments: ReadonlyArray<BoeFragment>;
} {
  const nodes = buildAstNodes(seeds);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ast: BoeAstDocument = {
    nodes,
    nodeById,
    indexes: buildAstIndexes(nodes),
  };

  const fragments = projectFragments(nodes);

  return { ast, fragments };
}

function buildAstNodes(seeds: ReadonlyArray<FragmentSeed>): ReadonlyArray<BoeAstNode> {
  const baseNodes = seeds.map((seed, sequenceIndex) => {
    const nodePath = renderPath(seed.nodePathSegments);
    const id = createAstNodeId({
      sequenceIndex,
      nodeType: seed.nodeType,
      nodePathSegments: seed.nodePathSegments,
      content: seed.content,
    });

    return {
      id,
      sequenceIndex,
      nodeType: seed.nodeType,
      content: seed.content,
      contentNormalized: seed.contentNormalized,
      nodePathSegments: seed.nodePathSegments,
      nodePath,
      legalPathAst:
        seed.legalNodePath === undefined ? undefined : parseLegalPath(seed.legalNodePath),
      legalNodePath: seed.legalNodePath,
      nodeNumber: seed.nodeNumber,
      nodeTitle: seed.nodeTitle,
      precedingContext: undefined,
      followingContext: undefined,
      parentNodeId: undefined,
    } satisfies BoeAstNode;
  });

  const idByPath = new Map<string, AstNodeId>();
  for (const node of baseNodes) {
    idByPath.set(String(node.nodePath), node.id);
  }

  return baseNodes.map((node, index) => {
    const previous = index > 0 ? baseNodes[index - 1] : undefined;
    const next = index < baseNodes.length - 1 ? baseNodes[index + 1] : undefined;

    if (node.nodePathSegments.length <= 1) {
      return {
        ...node,
        precedingContext: previous
          ? previous.content.slice(Math.max(0, previous.content.length - 180))
          : undefined,
        followingContext: next ? next.content.slice(0, 180) : undefined,
      };
    }

    const parentPath = renderPath(node.nodePathSegments.slice(0, -1));

    return {
      ...node,
      precedingContext: previous
        ? previous.content.slice(Math.max(0, previous.content.length - 180))
        : undefined,
      followingContext: next ? next.content.slice(0, 180) : undefined,
      parentNodeId: idByPath.get(String(parentPath)),
    };
  });
}

function projectFragments(nodes: ReadonlyArray<BoeAstNode>): ReadonlyArray<BoeFragment> {
  return nodes.map((node) => ({
    content: node.content,
    contentNormalized: node.contentNormalized,
    nodePath: node.nodePath,
    legalNodePath: node.legalNodePath,
    nodeType: node.nodeType,
    nodeNumber: node.nodeNumber,
    nodeTitle: node.nodeTitle,
    sequenceIndex: node.sequenceIndex,
    precedingContext: node.precedingContext,
    followingContext: node.followingContext,
  }));
}
