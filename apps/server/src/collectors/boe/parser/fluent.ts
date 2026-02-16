import { Effect } from "effect";

import type { BoeParseError } from "./errors";
import type { BoeFragment, BuildInput, LinearBlock, ParagraphBlock } from "./types";

export interface FragmentBuilder {
  readonly chapter: (title: string) => FragmentBuilder;
  readonly article: (input: { number: string; title?: string }) => FragmentBuilder;
  readonly paragraph: (content: string) => FragmentBuilder;
  readonly subparagraph: (input: { marker: string; content: string }) => FragmentBuilder;
  readonly annex: (input: { number: string; title?: string }) => FragmentBuilder;
  readonly table: (content: string) => FragmentBuilder;
  readonly build: () => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
}

type BuildFragments = (
  input: BuildInput,
) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;

export function createFragmentBuilder(
  buildFragments: BuildFragments,
  input: Omit<BuildInput, "blocks">,
): FragmentBuilder {
  const make = (blocks: ReadonlyArray<LinearBlock>): FragmentBuilder => ({
    chapter: (title) => make([...blocks, paragraphBlock("capitulo", title)]),
    article: ({ number, title }) =>
      make([...blocks, paragraphBlock("articulo", [number, title].filter(Boolean).join(" "))]),
    paragraph: (content) => make([...blocks, paragraphBlock("parrafo", content)]),
    subparagraph: ({ marker, content }) =>
      make([...blocks, paragraphBlock("parrafo_2", `${marker}) ${content}`)]),
    annex: ({ number, title }) => {
      const nextBlocks: Array<LinearBlock> = [...blocks, paragraphBlock("anexo_num", number)];
      if (title !== undefined && title.length > 0) {
        nextBlocks.push(paragraphBlock("anexo_tit", title));
      }
      return make(nextBlocks);
    },
    table: (content) => make([...blocks, { kind: "table", text: content }]),
    build: () =>
      buildFragments({
        ...input,
        blocks,
      }),
  });

  return make([]);
}

const paragraphBlock = (className: string, text: string): ParagraphBlock => ({
  kind: "paragraph",
  className,
  text,
});
