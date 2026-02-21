import type { BuildState } from "./traversal";
import {
  applyToken,
  classifyBlock,
  finalizeAstDocument,
  initialState,
  toTextNode,
} from "./traversal";
import type { FragmentSeed } from "./traversal";
import type { BoeAstDocument, BoeFragment, BoeTextNode, BuildInput, LinearBlock } from "./types";

export function blocksToTextNodes(blocks: ReadonlyArray<LinearBlock>): ReadonlyArray<BoeTextNode> {
  return blocks.map(classifyBlock).map(toTextNode);
}

export function buildFragments(input: BuildInput): ReadonlyArray<BoeFragment> {
  return buildAst(input).fragments;
}

export function buildAst(input: BuildInput): {
  readonly ast: BoeAstDocument;
  readonly fragments: ReadonlyArray<BoeFragment>;
} {
  const tokens = input.blocks.map(classifyBlock);
  const seeds: Array<FragmentSeed> = [];
  let state: BuildState = initialState();

  for (const token of tokens) {
    const next = applyToken(state, token, input.metadata, input.strategy);
    state = next.state;
    seeds.push(...next.emits);
  }

  return finalizeAstDocument(seeds);
}
