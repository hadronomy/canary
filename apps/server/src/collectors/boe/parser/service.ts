import { Effect, Schema } from "effect";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { EmbeddingService } from "~/services/embedding";

import {
  InvalidMetadataError,
  MissingRootDocumentoError,
  XmlParseError,
  type BoeParseError,
} from "./errors";
import { createFragmentBuilder } from "./fluent";
import { formatFragmentsAsMarkdown, selectFragmentsByPathQuery } from "./format";
import { blocksToTextNodes, buildAst } from "./fragments";
import { assertFragmentInvariants } from "./invariants";
import { assertTextoRoot, linearizeOrderedTextBlocks } from "./linearize";
import { toCanonicalFragmentPathQuery } from "./path-query";
import type { LegalQuery } from "./query";
import { evaluateQuery, selectByLegalPath } from "./query";
import { determineParsingStrategy } from "./strategy";
import type {
  BoeAnalysis,
  BoeParsedDocument,
  BoeMetadata,
  BoeXmlDocument,
  BuildInput,
  FragmentPathQuery,
  FragmentTokenCountResult,
  LegalNodePathString,
  LegalReference,
  ParseInput,
} from "./types";
import { BoeMetadataSchema } from "./types";

const decodeDate = Schema.decodeUnknownSync(Schema.String.pipe(Schema.pattern(/^\d{8}$/)));
const decodeBoeMetadata = Schema.decodeUnknownSync(BoeMetadataSchema);

function createOrderedParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    preserveOrder: true,
  });
}

interface ParsedRawDocument {
  readonly documentoEntries: ReadonlyArray<unknown>;
  readonly ordered: unknown;
}

export class BoeXmlParser extends Effect.Service<BoeXmlParser>()("BoeXmlParser", {
  accessors: true,
  effect: Effect.sync(() => {
    const orderedParser = createOrderedParser();

    const parseRaw = Effect.fn("BoeXmlParser.parseRaw")((xml: string) =>
      Effect.try({
        try: (): ParsedRawDocument => {
          const validation = XMLValidator.validate(xml);
          if (validation !== true) {
            throw new XmlParseError({
              message: `Invalid BOE XML: ${validation.err.msg}`,
              cause: validation.err,
            });
          }

          const ordered = orderedParser.parse(xml);
          const documentoEntries = getDocumentoEntries(ordered);
          if (documentoEntries.length === 0) {
            throw new MissingRootDocumentoError({
              message: "Missing root <documento> element",
            });
          }

          return {
            documentoEntries,
            ordered,
          };
        },
        catch: (cause) => toParseError(cause),
      }),
    );

    const parse = Effect.fn("BoeXmlParser.parse")((input: ParseInput) =>
      Effect.gen(function* () {
        const raw = yield* parseRaw(input.xml);
        const metadata = yield* decodeMetadata(raw.documentoEntries);
        const analysis = extractAnalysis(raw.documentoEntries);
        const blocks = yield* linearizeBlocks(raw.ordered);
        const strategy = determineParsingStrategy(metadata);
        const built = yield* buildAstFromInput({ metadata, strategy, blocks });

        return {
          metadata,
          analysis,
          text: blocksToTextNodes(blocks),
          strategy,
          blocks,
          ast: built.ast,
          fragments: built.fragments,
        } satisfies BoeParsedDocument;
      }),
    );

    const parseDocument = Effect.fn("BoeXmlParser.parseDocument")((input: ParseInput) =>
      parse(input).pipe(
        Effect.map(
          (document) =>
            ({
              metadata: document.metadata,
              analysis: document.analysis,
              text: document.text,
            }) satisfies BoeXmlDocument,
        ),
      ),
    );

    const parseForIndexing = Effect.fn("BoeXmlParser.parseForIndexing")((input: ParseInput) =>
      Effect.gen(function* () {
        const raw = yield* parseRaw(input.xml);
        const metadata = yield* decodeMetadata(raw.documentoEntries);
        const blocks = yield* linearizeBlocks(raw.ordered);
        const strategy = determineParsingStrategy(metadata);
        return yield* buildFragmentsFromInput({ metadata, strategy, blocks });
      }),
    );

    const buildAstFromInput = Effect.fn("BoeXmlParser.buildAst")((input: BuildInput) =>
      Effect.gen(function* () {
        const built = buildAst(input);
        yield* assertFragmentInvariants(built.fragments);
        return built;
      }),
    );

    const buildFragmentsFromInput = Effect.fn("BoeXmlParser.buildFragments")((input: BuildInput) =>
      buildAstFromInput(input).pipe(Effect.map((built) => built.fragments)),
    );

    const parseToFragments = Effect.fn("BoeXmlParser.parseToFragments")((input: ParseInput) =>
      parseForIndexing(input),
    );

    const fragmentBuilder = Effect.fn("BoeXmlParser.fragmentBuilder")(
      (input: Omit<BuildInput, "blocks">) =>
        Effect.succeed(createFragmentBuilder(buildFragmentsFromInput, input)),
    );

    const selectByPath = Effect.fn("BoeXmlParser.selectByPath")(
      (input: { readonly document: BoeParsedDocument; readonly query: FragmentPathQuery }) =>
        Effect.succeed(selectFragmentsByIndexedPath(input.document, input.query)),
    );

    const selectByLegalPathEffect = Effect.fn("BoeXmlParser.selectByLegalPath")(
      (input: {
        readonly document: BoeParsedDocument;
        readonly legalPath: LegalNodePathString | string;
      }) => Effect.succeed(selectByLegalPath(input.document.fragments, input.legalPath)),
    );

    const queryLegal = Effect.fn("BoeXmlParser.queryLegal")(
      (input: { readonly document: BoeParsedDocument; readonly query: LegalQuery }) =>
        Effect.succeed(evaluateQuery(input.document.fragments, input.query)),
    );

    const formatMarkdownByPath = Effect.fn("BoeXmlParser.formatMarkdownByPath")(
      (input: { readonly document: BoeParsedDocument; readonly query: FragmentPathQuery }) =>
        Effect.succeed(
          formatFragmentsAsMarkdown(input.document.fragments, input.query, input.document.metadata),
        ),
    );

    const countTokensByPath = Effect.fn("BoeXmlParser.countTokensByPath")(
      (input: { readonly document: BoeParsedDocument; readonly query: FragmentPathQuery }) =>
        Effect.gen(function* () {
          const selected = selectFragmentsByPathQuery(input.document.fragments, input.query);
          const selectedByAst = selectFragmentsByIndexedPath(input.document, input.query);
          const selectedFinal = selectedByAst.length > 0 ? selectedByAst : selected;
          const embeddingService = yield* EmbeddingService;
          const tokenResult = yield* embeddingService
            .countTokens(selectedFinal.map((fragment) => fragment.content))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new XmlParseError({
                    message: "Failed to count tokens using embedding service",
                    cause,
                  }),
              ),
            );

          if (tokenResult.counts.length !== selectedFinal.length) {
            return yield* new XmlParseError({
              message: `Token count mismatch: expected ${selectedFinal.length}, got ${tokenResult.counts.length}`,
            });
          }

          const fragmentTokenCounts = selectedFinal.map((fragment, index) => ({
            fragment,
            tokenCount: tokenResult.counts[index]!,
          }));

          const totalTokens = fragmentTokenCounts.reduce(
            (total, current) => total + current.tokenCount,
            0,
          );

          return {
            model: tokenResult.model,
            totalTokens,
            fragments: fragmentTokenCounts,
          } satisfies FragmentTokenCountResult;
        }),
    );

    return {
      parse,
      buildAst: buildAstFromInput,
      parseDocument,
      parseForIndexing,
      buildFragments: buildFragmentsFromInput,
      parseToFragments,
      selectByPath,
      selectByLegalPath: selectByLegalPathEffect,
      queryLegal,
      formatMarkdownByPath,
      countTokensByPath,
      fragmentBuilder,
    };
  }),
}) {}

function selectFragmentsByIndexedPath(
  document: BoeParsedDocument,
  query: FragmentPathQuery,
): ReadonlyArray<(typeof document.fragments)[number]> {
  const canonical = toCanonicalFragmentPathQuery(query);
  const ids = document.ast.indexes.byFragmentScope.get(canonical);
  if (ids === undefined) {
    return selectFragmentsByPathQuery(document.fragments, query);
  }

  const fragments = ids
    .map((id) => document.ast.nodeById.get(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined)
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map((node) => document.fragments[node.sequenceIndex])
    .filter((fragment): fragment is NonNullable<typeof fragment> => fragment !== undefined);

  return fragments;
}

const decodeMetadata = (
  documentoEntries: ReadonlyArray<unknown>,
): Effect.Effect<BoeMetadata, BoeParseError> =>
  Effect.try({
    try: () => extractMetadata(documentoEntries),
    catch: (cause) => toParseError(cause),
  });

const linearizeBlocks = (ordered: unknown) =>
  Effect.try({
    try: () => {
      assertTextoRoot(ordered);
      return linearizeOrderedTextBlocks(ordered);
    },
    catch: (cause) => toParseError(cause),
  });

function extractMetadata(documentoEntries: ReadonlyArray<unknown>): BoeMetadata {
  const metadatosEntries = getChildEntries(documentoEntries, "metadatos");
  const metadatos = asRecord(orderedEntriesToRecord(metadatosEntries));
  const identifier = asText(metadatos.identificador);
  const title = asText(metadatos.titulo);
  const department = asText(metadatos.departamento);
  const documentType = asText(metadatos.rango);
  const publicationDate = decodeDate(asText(metadatos.fecha_publicacion));
  const pdfUrlRaw = asText(metadatos.url_pdf);
  const eliUrl = asText(metadatos.url_eli);
  const seccion = asText(metadatos.seccion);
  const subseccion = asText(metadatos.subseccion);

  const rangoRecord = asRecord(metadatos.rango);
  const rangoCodigo = asText(rangoRecord["@_codigo"]);

  const pdfUrl =
    pdfUrlRaw.length > 0
      ? pdfUrlRaw.startsWith("http")
        ? pdfUrlRaw
        : `https://www.boe.es${pdfUrlRaw}`
      : "";

  return decodeBoeMetadata({
    identifier,
    title,
    department,
    documentType,
    publicationDate,
    pdfUrl,
    eliUrl,
    rangoCodigo,
    seccion,
    subseccion,
  });
}

function extractAnalysis(documentoEntries: ReadonlyArray<unknown>): BoeAnalysis {
  const analysisEntries = getChildEntries(documentoEntries, "analisis");
  const analysis = asRecord(orderedEntriesToRecord(analysisEntries));

  return {
    subjects: extractTextArray(asRecord(analysis.materias).materia),
    notes: extractTextArray(asRecord(analysis.notas).nota),
    priorReferences: extractReferences(
      asRecord(asRecord(analysis.referencias).anteriores).anterior,
    ),
    posteriorReferences: extractReferences(
      asRecord(asRecord(analysis.referencias).posteriores).posterior,
    ),
  };
}

function extractReferences(input: unknown): ReadonlyArray<LegalReference> {
  const entries = asArray(input);
  return entries
    .map((entry): LegalReference | null => {
      const record = asRecord(entry);
      const reference = asText(record.referencia);
      const type = asText(record.tipo);
      const text = asText(record["#text"]);
      if (reference.length === 0 && text.length === 0) {
        return null;
      }

      return {
        reference,
        type,
        text,
      };
    })
    .filter((entry): entry is LegalReference => entry !== null);
}

function extractTextArray(input: unknown): ReadonlyArray<string> {
  return asArray(input)
    .map((entry) => asText(isRecord(entry) ? entry["#text"] : entry))
    .filter((entry) => entry.length > 0);
}

function toParseError(cause: unknown): BoeParseError {
  if (isSchemaParseError(cause)) {
    return new InvalidMetadataError({
      message: cause.message,
    });
  }

  if (isParseError(cause)) {
    return cause;
  }

  return new XmlParseError({
    message: `Failed to parse BOE XML: ${String(cause)}`,
    cause,
  });
}

function isParseError(cause: unknown): cause is BoeParseError {
  if (!isRecord(cause) || typeof cause._tag !== "string") {
    return false;
  }

  return (
    cause._tag === "MissingRootDocumentoError" ||
    cause._tag === "InvalidMetadataError" ||
    cause._tag === "UnsupportedStrategyError" ||
    cause._tag === "MalformedTextSectionError" ||
    cause._tag === "NodePathCollisionError" ||
    cause._tag === "EmptyFragmentContentError" ||
    cause._tag === "XmlParseError"
  );
}

function isSchemaParseError(
  cause: unknown,
): cause is { readonly _tag: "ParseError"; readonly message: string } {
  return isRecord(cause) && cause._tag === "ParseError" && typeof cause.message === "string";
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (isRecord(value)) {
    if (typeof value["#text"] === "string") {
      return value["#text"].trim();
    }
    if (typeof value["#text"] === "number") {
      return String(value["#text"]);
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getDocumentoEntries(ordered: unknown): ReadonlyArray<unknown> {
  const entries = asArray(ordered);
  for (const entry of entries) {
    if (!isRecord(entry) || entry.documento === undefined) {
      continue;
    }
    return asArray(entry.documento);
  }
  return [];
}

function getChildEntries(entries: ReadonlyArray<unknown>, tag: string): ReadonlyArray<unknown> {
  for (const entry of entries) {
    if (!isRecord(entry) || entry[tag] === undefined) {
      continue;
    }
    return asArray(entry[tag]);
  }
  return [];
}

function orderedEntriesToRecord(entries: ReadonlyArray<unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const entry of entries) {
    if (typeof entry === "string") {
      record["#text"] = entry;
      continue;
    }
    if (typeof entry === "number") {
      record["#text"] = String(entry);
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const entryAttributes = asRecord(entry[":@"]);
    const hasExplicitAttributes = Object.keys(entryAttributes).length > 0;

    for (const [key, value] of Object.entries(entry)) {
      if (key === ":@") {
        continue;
      }

      const arrayValue = asArray(value);
      const nestedRecord = orderedEntriesToRecord(arrayValue);

      if (hasExplicitAttributes) {
        Object.assign(nestedRecord, entryAttributes);
      }

      const textValue = asText(nestedRecord["#text"] ?? nestedRecord.text ?? nestedRecord.value);
      const hasOnlyText = Object.keys(nestedRecord).every(
        (nestedKey) => nestedKey === "#text" || nestedKey.startsWith("@_"),
      );
      const shouldSimplifyToText =
        hasOnlyText && nestedRecord["#text"] !== undefined && !hasExplicitAttributes;
      record[key] = shouldSimplifyToText ? textValue : nestedRecord;
    }
  }
  return record;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
