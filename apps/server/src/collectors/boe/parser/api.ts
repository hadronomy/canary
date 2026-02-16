import type { Effect } from "effect";

import type { BoeParseError } from "./errors";
import type { LegalQuery, LegalQueryResult } from "./query";
import type {
  BoeFragment,
  BoeXmlDocument,
  BuildInput,
  FragmentPathQuery,
  FragmentTokenCountResult,
  MarkdownString,
  ParseInput,
} from "./types";

export interface BoeFragmentBuilderApi {
  readonly buildFragments: (
    input: BuildInput,
  ) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
}

export interface BoeXmlParserApi extends BoeFragmentBuilderApi {
  readonly parseDocument: (input: ParseInput) => Effect.Effect<BoeXmlDocument, BoeParseError>;
  readonly parseToFragments: (
    input: ParseInput,
  ) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly selectByPath: (input: {
    readonly xml: string;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly selectByLegalPath: (input: {
    readonly xml: string;
    readonly legalPath: string;
  }) => Effect.Effect<ReadonlyArray<BoeFragment>, BoeParseError>;
  readonly queryLegal: (input: {
    readonly xml: string;
    readonly query: LegalQuery;
  }) => Effect.Effect<LegalQueryResult, BoeParseError>;
  readonly formatMarkdownByPath: (input: {
    readonly xml: string;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<MarkdownString, BoeParseError>;
  readonly countTokensByPath: (input: {
    readonly xml: string;
    readonly query: FragmentPathQuery;
  }) => Effect.Effect<FragmentTokenCountResult, BoeParseError>;
}
