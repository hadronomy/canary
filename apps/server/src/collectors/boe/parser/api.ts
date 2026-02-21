import type { Effect } from "effect";

import type { EmbeddingService } from "~/services/embedding";

import type { BoeParseError } from "./errors";
import type { LegalQuery, LegalQueryResult } from "./query";
import type {
  BoeAstDocument,
  BoeFragment,
  BoeParsedDocument,
  BoeXmlDocument,
  BuildInput,
  FragmentPathQuery,
  FragmentTokenCountResult,
  LegalNodePathString,
  MarkdownString,
  ParseInput,
} from "./types";

export interface BoeFragmentBuilderApi {
  readonly buildAst: (
    input: BuildInput,
  ) => Effect.Effect<
    { readonly ast: BoeAstDocument; readonly fragments: ReadonlyArray<BoeFragment> },
    BoeParseError
  >;
  readonly buildFragments: (
    input: BuildInput,
  ) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
}

export interface BoeXmlParserApi extends BoeFragmentBuilderApi {
  readonly parse: (input: ParseInput) => Effect.Effect<BoeParsedDocument, BoeParseError>;
  readonly parseDocument: (input: ParseInput) => Effect.Effect<BoeXmlDocument, BoeParseError>;
  readonly parseToFragments: (
    input: ParseInput,
  ) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly selectByPath: (input: {
    readonly document: BoeParsedDocument;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly selectByLegalPath: (input: {
    readonly document: BoeParsedDocument;
    readonly legalPath: LegalNodePathString | string;
  }) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly queryLegal: (input: {
    readonly document: BoeParsedDocument;
    readonly query: LegalQuery;
  }) => Effect.Effect<LegalQueryResult, BoeParseError>;
  readonly formatMarkdownByPath: (input: {
    readonly document: BoeParsedDocument;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<MarkdownString, BoeParseError>;
  readonly countTokensByPath: (input: {
    readonly document: BoeParsedDocument;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<FragmentTokenCountResult, BoeParseError, EmbeddingService>;
}
