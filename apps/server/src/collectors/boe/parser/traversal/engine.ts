import type { NodeType } from "@canary/db/schema/legislation";

import { legalScopeSegments, specialSectionNodeType } from "../legal-scope";
import { normalizeLegalPathSegment } from "../normalize";
import { renderLegalPath } from "../path-query";
import type {
  BoeMetadata,
  LegalPathSegment,
  LegalNodePathString as LegalNodePath,
  NodePath,
  ParsingStrategy,
} from "../types";
import { LegalNodePathString } from "../types";
import { Path } from "./path-allocator";
import type { AnnexState, BuildState, ClassifiedBlock, FragmentSeed, MainState } from "./types";

interface Transition {
  readonly state: BuildState;
  readonly emits: ReadonlyArray<FragmentSeed>;
}

export const applyToken = (
  state: BuildState,
  token: ClassifiedBlock,
  metadata: BoeMetadata,
  strategy: ParsingStrategy,
): Transition => {
  switch (token._tag) {
    case "table":
      return handleTable(state, token, metadata);
    case "titleHeading":
      return handleTitleHeading(state, token, metadata);
    case "annexNumber":
      return handleAnnexNumber(state, token, metadata);
    case "annexTitle":
      return handleAnnexTitle(state, token, metadata);
    case "chapter":
      return handleChapter(state, token, metadata);
    case "sectionHeading":
      return handleSectionHeading(state, token, metadata);
    case "article":
      return handleArticle(state, token, metadata);
    case "subsection":
      return handleSubsection(state, token, metadata);
    case "subparagraph":
      return handleSubparagraph(state, token, metadata);
    case "signature":
      return emitParagraph(state, metadata, token.content, strategy, {
        nodeTypeOverride: "paragraph",
        nodeTitle: token.role,
      });
    case "paragraph":
      return emitParagraph(state, metadata, token.content, strategy);
    case "raw":
      return emitParagraph(state, metadata, token.content, strategy, {
        nodeTypeOverride: "paragraph",
        nodeTitle: token.className.length > 0 ? `raw:${token.className}` : "raw",
      });
  }
};

const handleTitleHeading = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "titleHeading" }>,
  metadata: BoeMetadata,
): Transition => {
  if (state.mode === "annex") {
    const annexState = ensureAnnexState(state);
    const annexKey = String(annexState.currentAnnex);
    const [sectionIndex, nextSections] = incrementCounter(annexState.annexSectionByIndex, annexKey);
    return {
      state: {
        ...annexState,
        annexSectionByIndex: nextSections,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(annexState.currentAnnex), Path.section(sectionIndex)],
          token.title,
          "subsection",
          { nodeTitle: token.title },
        ),
      ],
    };
  }

  const chapterIndex = state.chapterIndex + 1;
  const nextState: MainState = {
    ...state,
    mode: "main",
    chapterIndex,
    currentChapter: chapterIndex,
    currentArticle: undefined,
    currentArticleLegalPath: undefined,
    legalArticleScopeBase: [],
  };

  return {
    state: nextState,
    emits: [
      makeSeed(metadata, [Path.chapter(chapterIndex)], token.title, "title", {
        nodeTitle: token.title,
      }),
    ],
  };
};

const handleTable = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "table" }>,
  metadata: BoeMetadata,
): Transition => {
  if (state.mode === "annex") {
    const key = String(state.currentAnnex);
    const [tableIndex, nextMap] = incrementCounter(state.annexTableByIndex, key);
    return {
      state: {
        ...state,
        annexTableByIndex: nextMap,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(state.currentAnnex), Path.table(tableIndex)],
          token.content,
          "paragraph",
          {
            nodeTitle: "table",
          },
        ),
      ],
    };
  }

  if (state.currentChapter !== undefined && state.currentArticle !== undefined) {
    const key = `${state.currentChapter}:${state.currentArticle}`;
    const [tableIndex, nextMap] = incrementCounter(state.tableByArticle, key);
    return {
      state: {
        ...state,
        tableByArticle: nextMap,
      },
      emits: [
        makeSeed(
          metadata,
          [
            Path.chapter(state.currentChapter),
            Path.article(state.currentArticle),
            Path.table(tableIndex),
          ],
          token.content,
          "paragraph",
          { nodeTitle: "table" },
        ),
      ],
    };
  }

  const rootTableIndex = state.rootTableIndex + 1;
  return {
    state: {
      ...state,
      rootTableIndex,
    },
    emits: [
      makeSeed(metadata, [Path.table(rootTableIndex)], token.content, "paragraph", {
        nodeTitle: "table",
      }),
    ],
  };
};

const handleAnnexNumber = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "annexNumber" }>,
  metadata: BoeMetadata,
): Transition => {
  const annexIndex = state.annexIndex + 1;
  const nextState: AnnexState = {
    ...state,
    mode: "annex",
    annexIndex,
    currentAnnex: annexIndex,
    currentArticle: undefined,
    currentArticleLegalPath: undefined,
    legalArticleScopeBase: annexLegalScopeBase(annexIndex),
  };

  return {
    state: nextState,
    emits: [
      makeSeed(metadata, [Path.annex(annexIndex)], token.number, "annex", {
        nodeNumber: token.number,
      }),
    ],
  };
};

const handleAnnexTitle = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "annexTitle" }>,
  metadata: BoeMetadata,
): Transition => {
  const annexState = ensureAnnexState(state);
  const annexKey = String(annexState.currentAnnex);
  const [headerIndex, nextHeaders] = incrementCounter(annexState.annexHeaderByIndex, annexKey);
  return {
    state: {
      ...annexState,
      annexHeaderByIndex: nextHeaders,
    },
    emits: [
      makeSeed(
        metadata,
        [Path.annex(annexState.currentAnnex), Path.header(headerIndex)],
        token.title,
        "annex",
        {
          nodeTitle: token.title,
        },
      ),
    ],
  };
};

const handleChapter = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "chapter" }>,
  metadata: BoeMetadata,
): Transition => {
  if (/^ANEXO\s+/i.test(token.title)) {
    const annexIndex = state.annexIndex + 1;
    return {
      state: {
        ...state,
        mode: "annex",
        annexIndex,
        currentAnnex: annexIndex,
        currentArticle: undefined,
        currentArticleLegalPath: undefined,
        legalArticleScopeBase: annexLegalScopeBase(annexIndex),
      },
      emits: [
        makeSeed(metadata, [Path.annex(annexIndex)], token.title, "annex", {
          nodeTitle: token.title,
        }),
      ],
    };
  }

  if (state.mode === "annex") {
    const annexKey = String(state.currentAnnex);
    const [sectionIndex, nextSections] = incrementCounter(state.annexSectionByIndex, annexKey);
    return {
      state: {
        ...state,
        annexSectionByIndex: nextSections,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(state.currentAnnex), Path.section(sectionIndex)],
          token.title,
          "subsection",
          { nodeTitle: token.title },
        ),
      ],
    };
  }

  const chapterIndex = state.chapterIndex + 1;
  const legalArticleScopeBase = legalScopeSegments(token.title, token.isSpecial);
  const nextState: MainState = {
    ...state,
    mode: "main",
    chapterIndex,
    currentChapter: chapterIndex,
    currentArticle: undefined,
    currentArticleLegalPath: undefined,
    legalArticleScopeBase,
  };

  return {
    state: nextState,
    emits: [
      makeSeed(
        metadata,
        [Path.chapter(chapterIndex)],
        token.title,
        specialSectionNodeType(token.title, token.isSpecial),
        {
          nodeTitle: token.title,
        },
      ),
    ],
  };
};

const handleArticle = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "article" }>,
  metadata: BoeMetadata,
): Transition => {
  const chapterState = ensureChapterState(state);
  const chapterKey = String(chapterState.currentChapter);
  const [articleIndex, nextArticles] = incrementCounter(chapterState.articleByChapter, chapterKey);
  const legalArticlePath = toLegalArticlePath(token.number, chapterState.legalArticleScopeBase);
  const nextState: MainState & { readonly currentChapter: number } = {
    ...chapterState,
    mode: "main",
    currentChapter: chapterState.currentChapter,
    currentArticle: articleIndex,
    currentArticleNumber: token.number,
    currentArticleTitle: token.title,
    currentArticleLegalPath: legalArticlePath,
    articleByChapter: nextArticles,
  };

  return {
    state: nextState,
    emits: [
      makeSeed(
        metadata,
        [Path.chapter(nextState.currentChapter), Path.article(articleIndex)],
        token.content,
        "article",
        {
          legalNodePath: legalArticlePath,
          nodeNumber: token.number,
          nodeTitle: token.title,
        },
      ),
    ],
  };
};

const handleSectionHeading = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "sectionHeading" }>,
  metadata: BoeMetadata,
): Transition => {
  if (state.mode === "annex") {
    const annexState = ensureAnnexState(state);
    const annexKey = String(annexState.currentAnnex);
    const [sectionIndex, nextSections] = incrementCounter(annexState.annexSectionByIndex, annexKey);
    return {
      state: {
        ...annexState,
        annexSectionByIndex: nextSections,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(annexState.currentAnnex), Path.section(sectionIndex)],
          token.title,
          "subsection",
          { nodeTitle: token.title },
        ),
      ],
    };
  }

  const chapterState = ensureChapterState(state);
  const chapterKey = String(chapterState.currentChapter);
  const [sectionIndex, nextSections] = incrementCounter(
    chapterState.subsectionByChapter,
    chapterKey,
  );
  const nextState: MainState & { readonly currentChapter: number } = {
    ...chapterState,
    currentChapter: chapterState.currentChapter,
    subsectionByChapter: nextSections,
    currentArticle: undefined,
    currentArticleLegalPath: undefined,
  };

  return {
    state: nextState,
    emits: [
      makeSeed(
        metadata,
        [Path.chapter(nextState.currentChapter), Path.section(sectionIndex)],
        token.title,
        "section",
        {
          nodeTitle: token.title,
        },
      ),
    ],
  };
};

const handleSubsection = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "subsection" }>,
  metadata: BoeMetadata,
): Transition => {
  if (state.mode === "annex") {
    const annexState = ensureAnnexState(state);
    const annexKey = String(annexState.currentAnnex);
    const [sectionIndex, nextSections] = incrementCounter(annexState.annexSectionByIndex, annexKey);
    return {
      state: {
        ...annexState,
        annexSectionByIndex: nextSections,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(annexState.currentAnnex), Path.section(sectionIndex)],
          token.title,
          "subsection",
          { nodeTitle: token.title },
        ),
      ],
    };
  }

  const chapterState = ensureChapterState(state);
  const chapterKey = String(chapterState.currentChapter);
  const [sectionIndex, nextSections] = incrementCounter(
    chapterState.subsectionByChapter,
    chapterKey,
  );
  return {
    state: {
      ...chapterState,
      subsectionByChapter: nextSections,
    },
    emits: [
      makeSeed(
        metadata,
        [Path.chapter(chapterState.currentChapter), Path.section(sectionIndex)],
        token.title,
        "subsection",
        {
          nodeTitle: token.title,
        },
      ),
    ],
  };
};

const handleSubparagraph = (
  state: BuildState,
  token: Extract<ClassifiedBlock, { readonly _tag: "subparagraph" }>,
  metadata: BoeMetadata,
): Transition => {
  if (state.mode === "annex") {
    const annexState = ensureAnnexState(state);
    const annexKey = String(annexState.currentAnnex);
    const [subparagraphIndex, nextSubparagraphs] = incrementCounter(
      annexState.annexSubparagraphByIndex,
      annexKey,
    );
    return {
      state: {
        ...annexState,
        annexSubparagraphByIndex: nextSubparagraphs,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(annexState.currentAnnex), Path.subparagraph(subparagraphIndex)],
          token.content,
          "subparagraph",
          { nodeNumber: token.marker },
        ),
      ],
    };
  }

  if (state.currentChapter !== undefined && state.currentArticle !== undefined) {
    const articleKey = `${state.currentChapter}:${state.currentArticle}`;
    const currentParagraphIndex = state.currentParagraphByArticle[articleKey];

    if (currentParagraphIndex !== undefined) {
      const paragraphKey = `${articleKey}:${currentParagraphIndex}`;
      const [subparagraphIndex, nextSubparagraphs] = incrementCounter(
        state.subparagraphByParagraph,
        paragraphKey,
      );
      return {
        state: {
          ...state,
          subparagraphByParagraph: nextSubparagraphs,
        },
        emits: [
          makeSeed(
            metadata,
            [
              Path.chapter(state.currentChapter),
              Path.article(state.currentArticle),
              Path.paragraph(currentParagraphIndex),
              Path.subparagraph(subparagraphIndex),
            ],
            token.content,
            "subparagraph",
            {
              legalNodePath:
                state.currentArticleLegalPath !== undefined
                  ? LegalNodePathString(
                      `${state.currentArticleLegalPath}/p/${currentParagraphIndex}/sp/${subparagraphIndex}`,
                    )
                  : undefined,
              nodeNumber: token.marker,
              nodeTitle: state.currentArticleTitle,
            },
          ),
        ],
      };
    }

    const [subparagraphIndex, nextSubparagraphs] = incrementCounter(
      state.subparagraphByArticle,
      articleKey,
    );
    return {
      state: {
        ...state,
        subparagraphByArticle: nextSubparagraphs,
      },
      emits: [
        makeSeed(
          metadata,
          [
            Path.chapter(state.currentChapter),
            Path.article(state.currentArticle),
            Path.subparagraph(subparagraphIndex),
          ],
          token.content,
          "subparagraph",
          {
            legalNodePath:
              state.currentArticleLegalPath !== undefined
                ? LegalNodePathString(`${state.currentArticleLegalPath}/sp/${subparagraphIndex}`)
                : undefined,
            nodeNumber: token.marker,
            nodeTitle: state.currentArticleTitle,
          },
        ),
      ],
    };
  }

  const preambuloParagraphIndex = state.preambuloParagraphIndex + 1;
  return {
    state: {
      ...state,
      preambuloParagraphIndex,
    },
    emits: [
      makeSeed(metadata, [Path.paragraph(preambuloParagraphIndex)], token.content, "preambulo", {
        nodeNumber: token.marker,
      }),
    ],
  };
};

const emitParagraph = (
  state: BuildState,
  metadata: BoeMetadata,
  content: string,
  strategy: ParsingStrategy,
  options?: {
    readonly nodeTypeOverride?: NodeType;
    readonly nodeTitle?: string;
  },
): Transition => {
  if (state.mode === "annex") {
    const annexState = ensureAnnexState(state);
    const annexKey = String(annexState.currentAnnex);
    const [paragraphIndex, nextParagraphs] = incrementCounter(
      annexState.annexParagraphByIndex,
      annexKey,
    );
    return {
      state: {
        ...annexState,
        annexParagraphByIndex: nextParagraphs,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.annex(annexState.currentAnnex), Path.paragraph(paragraphIndex)],
          content,
          options?.nodeTypeOverride ?? "paragraph",
          {
            nodeTitle: options?.nodeTitle,
          },
        ),
      ],
    };
  }

  if (state.currentChapter !== undefined && state.currentArticle !== undefined) {
    const key = `${state.currentChapter}:${state.currentArticle}`;
    const [paragraphIndex, nextParagraphs] = incrementCounter(state.paragraphByArticle, key);
    const nextCurrentParagraphByArticle = {
      ...state.currentParagraphByArticle,
      [key]: paragraphIndex,
    };
    return {
      state: {
        ...state,
        paragraphByArticle: nextParagraphs,
        currentParagraphByArticle: nextCurrentParagraphByArticle,
      },
      emits: [
        makeSeed(
          metadata,
          [
            Path.chapter(state.currentChapter),
            Path.article(state.currentArticle),
            Path.paragraph(paragraphIndex),
          ],
          content,
          options?.nodeTypeOverride ?? "paragraph",
          {
            nodeNumber: state.currentArticleNumber,
            legalNodePath:
              state.currentArticleLegalPath !== undefined
                ? LegalNodePathString(`${state.currentArticleLegalPath}/p/${paragraphIndex}`)
                : undefined,
            nodeTitle: options?.nodeTitle ?? state.currentArticleTitle,
          },
        ),
      ],
    };
  }

  if (state.currentChapter !== undefined) {
    const chapterKey = String(state.currentChapter);
    const [paragraphIndex, nextParagraphs] = incrementCounter(
      state.chapterParagraphByChapter,
      chapterKey,
    );
    return {
      state: {
        ...state,
        chapterParagraphByChapter: nextParagraphs,
      },
      emits: [
        makeSeed(
          metadata,
          [Path.chapter(state.currentChapter), Path.paragraph(paragraphIndex)],
          content,
          options?.nodeTypeOverride ?? "paragraph",
          {
            nodeTitle: options?.nodeTitle,
          },
        ),
      ],
    };
  }

  const preambuloParagraphIndex = state.preambuloParagraphIndex + 1;
  return {
    state: {
      ...state,
      preambuloParagraphIndex,
    },
    emits: [
      makeSeed(
        metadata,
        [Path.paragraph(preambuloParagraphIndex)],
        content,
        options?.nodeTypeOverride ?? (strategy === "legislative" ? "preambulo" : "paragraph"),
        {
          nodeTitle: options?.nodeTitle,
        },
      ),
    ],
  };
};

const ensureChapterState = (state: BuildState): MainState & { readonly currentChapter: number } => {
  if (state.currentChapter !== undefined) {
    return {
      ...state,
      mode: "main",
      currentChapter: state.currentChapter,
    };
  }

  const chapterIndex = state.chapterIndex + 1;
  return {
    ...state,
    mode: "main",
    chapterIndex,
    currentChapter: chapterIndex,
    currentArticle: undefined,
  };
};

const ensureAnnexState = (state: BuildState): AnnexState => {
  if (state.mode === "annex") {
    return state;
  }

  const annexIndex = state.annexIndex + 1;
  return {
    ...state,
    mode: "annex",
    annexIndex,
    currentAnnex: annexIndex,
    currentArticle: undefined,
    currentArticleLegalPath: undefined,
    legalArticleScopeBase: annexLegalScopeBase(annexIndex),
  };
};

const incrementCounter = (
  map: Record<string, number>,
  key: string,
): readonly [number, Record<string, number>] => {
  const nextValue = (map[key] ?? 0) + 1;
  return [nextValue, { ...map, [key]: nextValue }];
};

const makeSeed = (
  metadata: BoeMetadata,
  nodePathSegments: NodePath,
  content: string,
  nodeType: NodeType,
  options?: {
    readonly legalNodePath?: LegalNodePath;
    readonly nodeNumber?: string;
    readonly nodeTitle?: string;
  },
): FragmentSeed => ({
  content,
  contentNormalized: content,
  nodePathSegments,
  nodeType,
  legalNodePath: options?.legalNodePath,
  nodeNumber: options?.nodeNumber,
  nodeTitle: options?.nodeTitle,
  metadata,
});

const toLegalArticlePath = (
  rawNumber: string,
  scopeBase: ReadonlyArray<LegalPathSegment>,
): LegalNodePath | undefined => {
  const cleaned = normalizeLegalPathSegment(rawNumber);

  if (cleaned.length === 0) {
    return undefined;
  }

  return renderLegalPath({
    segments: [...scopeBase, { _tag: "article", value: cleaned }],
  });
};

function annexLegalScopeBase(annexIndex: number): ReadonlyArray<LegalPathSegment> {
  return [
    { _tag: "custom", value: "annex" },
    { _tag: "custom", value: String(annexIndex) },
  ];
}
