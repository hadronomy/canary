import { Brand, Schema } from "effect";

import type { NodeType } from "@canary/db/schema/legislation";

export interface LegalReference {
  readonly reference: string;
  readonly type: string;
  readonly text: string;
}

export interface BoeMetadata {
  readonly identifier: string;
  readonly title: string;
  readonly department: string;
  readonly documentType: string;
  readonly publicationDate: string;
  readonly pdfUrl: string;
  readonly eliUrl: string;
  readonly rangoCodigo: string;
  readonly seccion: string;
  readonly subseccion: string;
}

export const BoeMetadataSchema = Schema.Struct({
  identifier: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  department: Schema.String,
  documentType: Schema.String,
  publicationDate: Schema.String.pipe(Schema.pattern(/^\d{8}$/)),
  pdfUrl: Schema.String,
  eliUrl: Schema.String,
  rangoCodigo: Schema.String,
  seccion: Schema.String,
  subseccion: Schema.String,
});

export interface BoeAnalysis {
  readonly subjects: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
  readonly priorReferences: ReadonlyArray<LegalReference>;
  readonly posteriorReferences: ReadonlyArray<LegalReference>;
}

export type BoeTextNode =
  | { readonly _tag: "preambulo"; readonly content: string }
  | { readonly _tag: "chapter"; readonly title: string }
  | { readonly _tag: "section"; readonly title: string }
  | { readonly _tag: "subsection"; readonly title: string }
  | { readonly _tag: "article"; readonly number: string; readonly title: string }
  | { readonly _tag: "paragraph"; readonly content: string }
  | { readonly _tag: "subparagraph"; readonly marker: string; readonly content: string }
  | { readonly _tag: "annex"; readonly number: string; readonly title: string }
  | { readonly _tag: "signature"; readonly role: string; readonly content: string }
  | { readonly _tag: "raw"; readonly content: string };

export interface BoeXmlDocument {
  readonly metadata: BoeMetadata;
  readonly analysis: BoeAnalysis;
  readonly text: ReadonlyArray<BoeTextNode>;
}

export interface BoeFragment {
  readonly content: string;
  readonly contentNormalized: string;
  readonly nodePath: NodePathString;
  readonly legalNodePath?: LegalNodePathString;
  readonly nodeType: NodeType;
  readonly nodeNumber?: string;
  readonly nodeTitle?: string;
  readonly precedingContext?: string;
  readonly followingContext?: string;
  readonly sequenceIndex: number;
  readonly metadata: BoeMetadata;
}

export interface FragmentTokenCount {
  readonly fragment: BoeFragment;
  readonly tokenCount: number;
}

export interface FragmentTokenCountResult {
  readonly model: string;
  readonly totalTokens: number;
  readonly fragments: ReadonlyArray<FragmentTokenCount>;
}

export type NodeKind =
  | "preambulo"
  | "chapter"
  | "section"
  | "subsection"
  | "article"
  | "paragraph"
  | "subparagraph"
  | "annex"
  | "signature"
  | "table"
  | "raw";

export type NodePathSegmentTag =
  | "chapter"
  | "article"
  | "paragraph"
  | "subparagraph"
  | "annex"
  | "table"
  | "section"
  | "header";

export interface NodePathSegment {
  readonly _tag: NodePathSegmentTag;
  readonly index: number;
}

export type NodePath = ReadonlyArray<NodePathSegment>;

export type NodePathString = string & Brand.Brand<"NodePathString">;
export const NodePathString = Brand.nominal<NodePathString>();
export const NodePathStringSchema = Schema.String.pipe(Schema.fromBrand(NodePathString));

export type LegalNodePathString = string & Brand.Brand<"LegalNodePathString">;
export const LegalNodePathString = Brand.nominal<LegalNodePathString>();
export const LegalNodePathStringSchema = Schema.String.pipe(Schema.fromBrand(LegalNodePathString));

export type MarkdownString = string & Brand.Brand<"MarkdownString">;
export const MarkdownString = Brand.nominal<MarkdownString>();
export const MarkdownStringSchema = Schema.String.pipe(Schema.fromBrand(MarkdownString));

export type FragmentPathScope = "p" | "c" | "x" | "t";
export type FragmentPathQuery = "/" | `/${FragmentPathScope}` | `/${FragmentPathScope}/`;
export type CanonicalFragmentPathQuery = "/" | `/${FragmentPathScope}/`;

export type ParsingStrategy = "legislative" | "simple" | "announcement" | "generic";

export interface ParagraphBlock {
  readonly kind: "paragraph";
  readonly className: string;
  readonly text: string;
}

export interface TableBlock {
  readonly kind: "table";
  readonly text: string;
}

export type LinearBlock = ParagraphBlock | TableBlock;

export interface BuildInput {
  readonly metadata: BoeMetadata;
  readonly strategy: ParsingStrategy;
  readonly blocks: ReadonlyArray<LinearBlock>;
}

export interface ParseInput {
  readonly xml: string;
}

export interface NormalizedChapterHeader {
  readonly title: string;
  readonly isSpecial: boolean;
}

export interface NormalizedArticleHeader {
  readonly number: string;
  readonly title: string;
}

export interface NormalizedSubparagraph {
  readonly marker: string;
  readonly content: string;
}
