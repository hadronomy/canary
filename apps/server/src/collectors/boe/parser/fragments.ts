import type { BuildState } from "./traversal";
import {
  applyToken,
  classifyBlock,
  finalizeFragments,
  initialState,
  toTextNode,
} from "./traversal";
import type { BoeFragment, BoeTextNode, BuildInput, LinearBlock } from "./types";

export function blocksToTextNodes(blocks: ReadonlyArray<LinearBlock>): ReadonlyArray<BoeTextNode> {
  return blocks.map(classifyBlock).map(toTextNode);
}

export function buildFragments(input: BuildInput): ReadonlyArray<BoeFragment> {
  const tokens = input.blocks.map(classifyBlock);
  const seeds = [] as Array<ReturnType<typeof applyToken>["emits"][number]>;
  let state: BuildState = initialState();

  for (const token of tokens) {
    const next = applyToken(state, token, input.metadata, input.strategy);
    state = next.state;
    seeds.push(...next.emits);
  }

  return finalizeFragments(seeds);
}
