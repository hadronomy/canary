import type { BoeFragment } from "../types";
import { renderPath } from "./path-allocator";
import type { FragmentSeed } from "./types";

export const finalizeFragments = (
  seeds: ReadonlyArray<FragmentSeed>,
): ReadonlyArray<BoeFragment> => {
  const fragments = seeds.map((seed, sequenceIndex) => ({
    content: seed.content,
    contentNormalized: seed.contentNormalized,
    nodePath: renderPath(seed.nodePathSegments),
    legalNodePath: seed.legalNodePath,
    nodeType: seed.nodeType,
    nodeNumber: seed.nodeNumber,
    nodeTitle: seed.nodeTitle,
    metadata: seed.metadata,
    sequenceIndex,
    precedingContext: undefined,
    followingContext: undefined,
  }));

  return fragments.map((fragment, index) => {
    const previous = index > 0 ? fragments[index - 1] : undefined;
    const next = index < fragments.length - 1 ? fragments[index + 1] : undefined;
    return {
      ...fragment,
      precedingContext: previous
        ? previous.content.slice(Math.max(0, previous.content.length - 180))
        : undefined,
      followingContext: next ? next.content.slice(0, 180) : undefined,
    };
  });
};
