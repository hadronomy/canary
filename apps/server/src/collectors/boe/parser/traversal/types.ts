import type { NodeType } from "@canary/db/schema/legislation";

import type { BoeMetadata, LegalNodePathString, NodePath } from "../types";

export type ClassifiedBlock =
  | { readonly _tag: "table"; readonly content: string }
  | { readonly _tag: "titleHeading"; readonly title: string }
  | { readonly _tag: "chapter"; readonly title: string; readonly isSpecial: boolean }
  | { readonly _tag: "sectionHeading"; readonly title: string }
  | {
      readonly _tag: "article";
      readonly number: string;
      readonly title: string;
      readonly content: string;
    }
  | { readonly _tag: "subsection"; readonly title: string }
  | { readonly _tag: "annexNumber"; readonly number: string }
  | { readonly _tag: "annexTitle"; readonly title: string }
  | { readonly _tag: "subparagraph"; readonly marker: string; readonly content: string }
  | { readonly _tag: "paragraph"; readonly content: string }
  | { readonly _tag: "signature"; readonly role: string; readonly content: string }
  | { readonly _tag: "raw"; readonly content: string; readonly className: string };

interface SharedState {
  readonly chapterIndex: number;
  readonly annexIndex: number;
  readonly currentArticle?: number;
  readonly currentArticleNumber: string;
  readonly currentArticleTitle: string;
  readonly currentArticleLegalPath?: LegalNodePathString;
  readonly legalArticleScopeBase: string;
  readonly preambuloParagraphIndex: number;
  readonly rootTableIndex: number;
  readonly articleByChapter: Record<string, number>;
  readonly paragraphByArticle: Record<string, number>;
  readonly subparagraphByArticle: Record<string, number>;
  readonly tableByArticle: Record<string, number>;
  readonly subsectionByChapter: Record<string, number>;
  readonly chapterParagraphByChapter: Record<string, number>;
  readonly annexParagraphByIndex: Record<string, number>;
  readonly annexSubparagraphByIndex: Record<string, number>;
  readonly annexTableByIndex: Record<string, number>;
  readonly annexHeaderByIndex: Record<string, number>;
  readonly annexSectionByIndex: Record<string, number>;
}

export interface MainState extends SharedState {
  readonly mode: "main";
  readonly currentChapter?: number;
}

export interface AnnexState extends SharedState {
  readonly mode: "annex";
  readonly currentAnnex: number;
  readonly currentChapter?: number;
}

export type BuildState = MainState | AnnexState;

export interface FragmentSeed {
  readonly content: string;
  readonly contentNormalized: string;
  readonly nodePathSegments: NodePath;
  readonly nodeType: NodeType;
  readonly legalNodePath?: LegalNodePathString;
  readonly nodeNumber?: string;
  readonly nodeTitle?: string;
  readonly metadata: BoeMetadata;
}

export const initialState = (): MainState => ({
  mode: "main",
  chapterIndex: 0,
  annexIndex: 0,
  currentChapter: undefined,
  currentArticle: undefined,
  currentArticleNumber: "",
  currentArticleTitle: "",
  currentArticleLegalPath: undefined,
  legalArticleScopeBase: "/article",
  preambuloParagraphIndex: 0,
  rootTableIndex: 0,
  articleByChapter: {},
  paragraphByArticle: {},
  subparagraphByArticle: {},
  tableByArticle: {},
  subsectionByChapter: {},
  chapterParagraphByChapter: {},
  annexParagraphByIndex: {},
  annexSubparagraphByIndex: {},
  annexTableByIndex: {},
  annexHeaderByIndex: {},
  annexSectionByIndex: {},
});
