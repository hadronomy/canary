import { Cause, Chunk, Config, DateTime, Effect, Schedule, Schema, Stream } from "effect";

import { and, eq, inArray, sql } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
import type { RelationType } from "@canary/db/schema/legislation";
import {
  documentVersions,
  fragmentIndexJobs,
  legalDocuments,
  nodeTypeEnum,
  referenceAnchors,
  senseFragments,
} from "@canary/db/schema/legislation";
import {
  BoeXmlParser,
  legalNodePathToLtree,
  nodePathToLtree,
  type BoeFragment,
  type LegalReference,
} from "~/collectors/boe/parser";
import { EmbeddingService, EmbeddingServiceLive } from "~/services/embedding";

import { IndexingWorkflowError } from "./errors";
import type { IndexingTriggerPayload } from "./schema";

const IndexingConfig = Config.all({
  upsertBatchSize: Config.number("INDEXING_UPSERT_BATCH_SIZE").pipe(Config.withDefault(250)),
  embedBatchSize: Config.number("INDEXING_EMBED_BATCH_SIZE").pipe(Config.withDefault(64)),
  embedConcurrency: Config.number("INDEXING_EMBED_CONCURRENCY").pipe(Config.withDefault(2)),
  profileMemory: Config.boolean("INDEXING_PROFILE_MEMORY").pipe(Config.withDefault(false)),
});

export const FragmentRowSchema = Schema.Struct({
  fragmentId: Schema.String,
  content: Schema.String,
});

export const ParsedFragmentSchema = Schema.Struct({
  content: Schema.String,
  contentNormalized: Schema.String,
  nodePath: Schema.String,
  nodePathLtree: Schema.String,
  legalNodePathLtree: Schema.NullOr(Schema.String),
  nodeType: Schema.Literal(...nodeTypeEnum.enumValues),
  nodeNumber: Schema.NullOr(Schema.String),
  nodeTitle: Schema.NullOr(Schema.String),
  precedingContext: Schema.NullOr(Schema.String),
  followingContext: Schema.NullOr(Schema.String),
  sequenceIndex: Schema.Number,
  contentFingerprint: Schema.String,
  validFrom: Schema.DateFromSelf,
  validUntil: Schema.NullOr(Schema.DateFromSelf),
});

interface ParsedFragment {
  readonly content: string;
  readonly contentNormalized: string;
  readonly nodePath: string;
  readonly nodePathLtree: string;
  readonly legalNodePathLtree: string | null;
  readonly nodeType: NonNullable<typeof senseFragments.$inferInsert.nodeType>;
  readonly nodeNumber: string | null;
  readonly nodeTitle: string | null;
  readonly precedingContext: string | null;
  readonly followingContext: string | null;
  readonly sequenceIndex: number;
  readonly contentFingerprint: string;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

interface FragmentRow {
  readonly fragmentId: string;
  readonly content: string;
}

export class BoeIndexingActivities extends Effect.Service<BoeIndexingActivities>()(
  "BoeIndexingActivities",
  {
    accessors: true,
    dependencies: [DatabaseService.Default, BoeXmlParser.Default, EmbeddingServiceLive],
    effect: Effect.gen(function* () {
      const db = yield* DatabaseService.client();
      const parser = yield* BoeXmlParser;
      const embedding = yield* EmbeddingService;
      const config = yield* IndexingConfig;
      const buildJobMetadata = (
        payload: IndexingTriggerPayload,
        executionId: string,
      ): Record<string, unknown> => ({
        runId: payload.runId,
        executionId,
        canonicalId: payload.canonicalId,
        contentHash: payload.contentHash,
        requestedAt: DateTime.formatIso(payload.requestedAt),
        kind: payload.kind,
      });

      const ensureIndexingTargetsExist = Effect.fn(
        "BoeIndexingActivities.ensureIndexingTargetsExist",
      )((payload: IndexingTriggerPayload, executionId: string) =>
        Effect.gen(function* () {
          const versionRows = yield* db
            .select({ docId: documentVersions.docId })
            .from(documentVersions)
            .where(eq(documentVersions.versionId, payload.versionId))
            .pipe(
              Effect.mapError((cause) =>
                toWorkflowError(
                  payload,
                  executionId,
                  "mark-in-progress-target-check",
                  cause,
                  "Unable to verify document version before marking indexing in progress",
                ),
              ),
            );

          const versionDocId = versionRows[0]?.docId;
          if (versionDocId === undefined) {
            return yield* toWorkflowError(
              payload,
              executionId,
              "mark-in-progress-target-check",
              undefined,
              "Indexing payload references missing document version",
            );
          }

          if (versionDocId !== payload.docId) {
            return yield* toWorkflowError(
              payload,
              executionId,
              "mark-in-progress-target-check",
              undefined,
              `Indexing payload doc/version mismatch. versionId belongs to docId ${versionDocId}, payload has ${payload.docId}`,
            );
          }

          const documentRows = yield* db
            .select({ docId: legalDocuments.docId })
            .from(legalDocuments)
            .where(eq(legalDocuments.docId, payload.docId))
            .pipe(
              Effect.mapError((cause) =>
                toWorkflowError(
                  payload,
                  executionId,
                  "mark-in-progress-target-check",
                  cause,
                  "Unable to verify legal document before marking indexing in progress",
                ),
              ),
            );

          if (documentRows[0] === undefined) {
            return yield* toWorkflowError(
              payload,
              executionId,
              "mark-in-progress-target-check",
              undefined,
              "Indexing payload references missing legal document",
            );
          }
        }),
      );

      const markInProgress = Effect.fn("BoeIndexingActivities.markInProgress")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          Effect.gen(function* () {
            yield* ensureIndexingTargetsExist(payload, executionId).pipe(
              Effect.retry({
                schedule: Schedule.intersect(
                  Schedule.exponential("100 millis"),
                  Schedule.recurs(5),
                ).pipe(Schedule.jittered),
                while: isRetryableTargetCheckError,
              }),
            );

            yield* db
              .insert(fragmentIndexJobs)
              .values({
                docId: payload.docId,
                versionId: payload.versionId,
                status: "in_progress",
                attempts: 1,
                startedAt: new Date(),
                metadata: buildJobMetadata(payload, executionId),
              })
              .onConflictDoUpdate({
                target: [fragmentIndexJobs.docId, fragmentIndexJobs.versionId],
                set: {
                  status: "in_progress",
                  attempts: sql`${fragmentIndexJobs.attempts} + 1`,
                  updatedAt: sql`now()`,
                  lastError: null,
                  metadata: sql`excluded.metadata`,
                },
              })
              .pipe(
                Effect.retry({
                  schedule: Schedule.intersect(
                    Schedule.exponential("100 millis"),
                    Schedule.recurs(5),
                  ).pipe(Schedule.jittered),
                  while: isForeignKeyViolationCause,
                }),
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "mark-in-progress",
                    cause,
                    "Unable to mark indexing job in progress",
                  ),
                ),
              );
          }).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("BoeIndexingActivities.markInProgress failed", {
                docId: payload.docId,
                versionId: payload.versionId,
                executionId,
                cause: formatUnknownCause(cause),
              }),
            ),
            Effect.asVoid,
          ),
      );

      const loadVersionContent = Effect.fn("BoeIndexingActivities.loadVersionContent")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          db
            .select({
              contentText: documentVersions.contentText,
              validFrom: documentVersions.validFrom,
              validUntil: documentVersions.validUntil,
            })
            .from(documentVersions)
            .where(eq(documentVersions.versionId, payload.versionId))
            .pipe(
              Effect.mapError((cause) =>
                toWorkflowError(
                  payload,
                  executionId,
                  "load-version",
                  cause,
                  "Unable to load document version content",
                ),
              ),
              Effect.flatMap((rows) => {
                const row = rows[0];
                if (!row || row.contentText === null || row.contentText.trim().length === 0) {
                  return Effect.fail(
                    toWorkflowError(
                      payload,
                      executionId,
                      "load-version",
                      undefined,
                      "Missing or empty version content",
                    ),
                  );
                }
                return Effect.succeed({
                  contentText: row.contentText,
                  validFrom: row.validFrom,
                  validUntil: row.validUntil,
                });
              }),
            ),
      );

      const ensureLatestVersion = Effect.fn("BoeIndexingActivities.ensureLatestVersion")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          Effect.gen(function* () {
            const current = yield* db
              .select({ versionNumber: documentVersions.versionNumber })
              .from(documentVersions)
              .where(eq(documentVersions.versionId, payload.versionId))
              .pipe(
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "version-check",
                    cause,
                    "Unable to read current version number",
                  ),
                ),
              );

            const currentVersionNumber = current[0]?.versionNumber;
            if (currentVersionNumber === undefined) {
              return yield* toWorkflowError(
                payload,
                executionId,
                "version-check",
                undefined,
                "Current document version was not found",
              );
            }

            const latest = yield* db
              .select({ latestVersionNumber: sql<number>`max(${documentVersions.versionNumber})` })
              .from(documentVersions)
              .where(eq(documentVersions.docId, payload.docId))
              .pipe(
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "version-check",
                    cause,
                    "Unable to read latest document version",
                  ),
                ),
              );

            const latestVersionNumber = latest[0]?.latestVersionNumber ?? currentVersionNumber;
            if (currentVersionNumber < latestVersionNumber) {
              return yield* toWorkflowError(
                payload,
                executionId,
                "version-check",
                undefined,
                `Stale indexing workflow payload. Current version ${currentVersionNumber} is older than latest ${latestVersionNumber}`,
              );
            }
          }),
      );

      const mapNodeToParsedFragment = (
        payload: IndexingTriggerPayload,
        fragment: BoeFragment,
        versionData: { readonly validFrom: Date; readonly validUntil: Date | null },
      ): ParsedFragment => {
        const nodePath = fragment.nodePath;
        const legalNodePath = fragment.legalNodePath;
        return {
          content: fragment.content,
          contentNormalized: fragment.contentNormalized,
          nodePath,
          nodePathLtree: String(nodePathToLtree(nodePath)),
          legalNodePathLtree:
            legalNodePath === undefined ? null : String(legalNodePathToLtree(legalNodePath)),
          nodeType: fragment.nodeType,
          nodeNumber: fragment.nodeNumber ?? null,
          nodeTitle: fragment.nodeTitle ?? null,
          precedingContext: fragment.precedingContext ?? null,
          followingContext: fragment.followingContext ?? null,
          sequenceIndex: fragment.sequenceIndex,
          contentFingerprint: createContentFingerprint(
            payload.docId,
            payload.versionId,
            nodePath,
            fragment.contentNormalized,
          ),
          validFrom: versionData.validFrom,
          validUntil: versionData.validUntil,
        };
      };

      const upsertFragmentBatch = Effect.fn("BoeIndexingActivities.upsertFragmentBatch")(
        (
          payload: IndexingTriggerPayload,
          executionId: string,
          parsedFragments: ReadonlyArray<ParsedFragment>,
        ) =>
          Effect.gen(function* () {
            if (parsedFragments.length === 0) {
              return [] as ReadonlyArray<FragmentRow>;
            }

            const now = new Date();
            const rows = parsedFragments.map((fragment) => ({
              docId: payload.docId,
              versionId: payload.versionId,
              content: fragment.content,
              contentNormalized: fragment.contentNormalized,
              nodePath: fragment.nodePath,
              nodePathLtree: fragment.nodePathLtree,
              legalNodePathLtree: fragment.legalNodePathLtree,
              nodeType: fragment.nodeType,
              nodeNumber: fragment.nodeNumber,
              nodeTitle: fragment.nodeTitle,
              precedingContext: fragment.precedingContext,
              followingContext: fragment.followingContext,
              sequenceIndex: fragment.sequenceIndex,
              contentFingerprint: fragment.contentFingerprint,
              validFrom: fragment.validFrom,
              validUntil: fragment.validUntil,
              updatedAt: now,
            }));

            return yield* db
              .insert(senseFragments)
              .values(rows)
              .onConflictDoUpdate({
                target: [senseFragments.docId, senseFragments.nodePathLtree],
                set: {
                  versionId: sql`excluded.version_id`,
                  content: sql`excluded.content`,
                  contentNormalized: sql`excluded.content_normalized`,
                  legalNodePathLtree: sql`excluded.legal_node_path_ltree`,
                  nodeType: sql`excluded.node_type`,
                  nodeNumber: sql`excluded.node_number`,
                  nodeTitle: sql`excluded.node_title`,
                  precedingContext: sql`excluded.preceding_context`,
                  followingContext: sql`excluded.following_context`,
                  sequenceIndex: sql`excluded.sequence_index`,
                  contentFingerprint: sql`excluded.content_fingerprint`,
                  validFrom: sql`excluded.valid_from`,
                  validUntil: sql`excluded.valid_until`,
                  updatedAt: sql`excluded.updated_at`,
                },
              })
              .returning({ fragmentId: senseFragments.fragmentId, content: senseFragments.content })
              .pipe(
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "upsert-fragments",
                    cause,
                    "Unable to upsert sense fragments",
                  ),
                ),
              );
          }),
      );

      const persistEmbeddingBatch = Effect.fn("BoeIndexingActivities.persistEmbeddingBatch")(
        (
          payload: IndexingTriggerPayload,
          executionId: string,
          rows: ReadonlyArray<{
            readonly fragmentId: string;
            readonly embedding1024: ReadonlyArray<number>;
            readonly embedding256: ReadonlyArray<number>;
          }>,
        ) =>
          Effect.gen(function* () {
            if (rows.length === 0) {
              return;
            }

            const toVectorLiteral = (vector: ReadonlyArray<number>) => `[${vector.join(",")}]`;
            const updatedAt = new Date();
            const fragmentIdColumn = sql.raw(`"${senseFragments.fragmentId.name}"`);
            const embedding1024Column = sql.raw(`"${senseFragments.embedding1024.name}"`);
            const embedding256Column = sql.raw(`"${senseFragments.embedding256.name}"`);
            const updatedAtColumn = sql.raw(`"${senseFragments.updatedAt.name}"`);

            const fragmentIds = rows.map((row) => row.fragmentId);
            const embedding1024Values = rows.map((row) => toVectorLiteral(row.embedding1024));
            const embedding256Values = rows.map((row) => toVectorLiteral(row.embedding256));

            yield* db
              .execute(sql`
                update ${senseFragments} as sf
                set
                  ${embedding1024Column} = v.embedding_1024_text::vector,
                  ${embedding256Column} = v.embedding_256_text::vector,
                  ${updatedAtColumn} = ${updatedAt}
                from (
                  select *
                  from unnest(
                    array[${sql.join(
                      fragmentIds.map((id) => sql`${id}::uuid`),
                      sql`, `,
                    )}]::uuid[],
                    array[${sql.join(
                      embedding1024Values.map((value) => sql`${value}`),
                      sql`, `,
                    )}]::text[],
                    array[${sql.join(
                      embedding256Values.map((value) => sql`${value}`),
                      sql`, `,
                    )}]::text[]
                  ) as t(fragment_id, embedding_1024_text, embedding_256_text)
                ) as v
                where sf.${fragmentIdColumn} = v.fragment_id
              `)
              .pipe(
                Effect.retry({
                  schedule: Schedule.intersect(
                    Schedule.exponential("100 millis"),
                    Schedule.recurs(2),
                  ).pipe(Schedule.jittered),
                }),
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "embed-fragments",
                    cause,
                    "Unable to persist generated fragment embeddings batch",
                  ),
                ),
                Effect.asVoid,
              );
          }),
      );

      const embedFragmentRows = Effect.fn("BoeIndexingActivities.embedFragmentRows")(
        (payload: IndexingTriggerPayload, executionId: string, rows: ReadonlyArray<FragmentRow>) =>
          Stream.fromIterable(rows).pipe(
            Stream.grouped(config.embedBatchSize),
            Stream.mapEffect(
              (batch) => {
                const batchRows = Chunk.toReadonlyArray(batch);
                return Effect.gen(function* () {
                  const vectors = yield* embedding
                    .embed(
                      batchRows.map((row) => row.content),
                      { task: "retrieval" },
                    )
                    .pipe(
                      Effect.mapError((cause) =>
                        toWorkflowError(
                          payload,
                          executionId,
                          "embed-fragments",
                          cause,
                          "Unable to generate embeddings for fragments",
                        ),
                      ),
                    );

                  if (!Array.isArray(vectors) || vectors.length !== batchRows.length) {
                    return yield* toWorkflowError(
                      payload,
                      executionId,
                      "embed-fragments",
                      undefined,
                      "Embedding service returned unexpected vector cardinality",
                    );
                  }

                  const embeddingRows = batchRows.map((row, index) => {
                    const vector = vectors[index];
                    if (vector === undefined) {
                      return Effect.fail(
                        toWorkflowError(
                          payload,
                          executionId,
                          "embed-fragments",
                          undefined,
                          `Missing embedding vector for fragment ${row.fragmentId} at index ${index}`,
                        ),
                      );
                    }

                    return Effect.succeed({
                      fragmentId: row.fragmentId,
                      embedding1024: vector.full,
                      embedding256: vector.scout,
                    });
                  });

                  const rowsToPersist = yield* Effect.all(embeddingRows);

                  yield* persistEmbeddingBatch(payload, executionId, rowsToPersist);

                  if (config.profileMemory) {
                    const usage = process.memoryUsage();
                    yield* Effect.logInfo("indexing.embed.batch.completed", {
                      docId: payload.docId,
                      versionId: payload.versionId,
                      batchSize: batchRows.length,
                      rssMb: Math.round(usage.rss / (1024 * 1024)),
                      heapUsedMb: Math.round(usage.heapUsed / (1024 * 1024)),
                    });
                  }
                });
              },
              { concurrency: Math.min(2, Math.max(1, config.embedConcurrency)) },
            ),
            Stream.runDrain,
          ),
      );

      const upsertDocumentReferences = Effect.fn("BoeIndexingActivities.upsertDocumentReferences")(
        (
          payload: IndexingTriggerPayload,
          executionId: string,
          references: ReadonlyArray<LegalReference>,
        ) =>
          Effect.gen(function* () {
            if (references.length === 0) {
              yield* Effect.logInfo("indexing.references.empty", {
                docId: payload.docId,
                versionId: payload.versionId,
                executionId,
              });
              return;
            }

            const mapRelationType = (type: string): RelationType => {
              const t = type.toUpperCase();
              if (t.includes("DEROGA")) return "deroga_total";
              if (t.includes("MODIFICA")) return "modifica";
              if (t.includes("DESARROLLA") || t.includes("COMPLEMENTA") || t.includes("RELACION"))
                return "complementa";
              if (t.includes("DECLARA") || t.includes("INTERPRETA") || t.includes("NULIDAD"))
                return "interpreta";
              return "cita_explicita";
            };

            const invalidReferenceInputs: Array<string> = [];
            const dedupedRows = new Map<
              string,
              {
                readonly sourceDocId: string;
                readonly targetCanonicalId: string;
                readonly relationType: RelationType;
                readonly extractionConfidence: number;
              }
            >();

            for (const ref of references) {
              const normalizedTargetCanonicalId = toTargetCanonicalId(ref.reference);
              if (normalizedTargetCanonicalId === null) {
                invalidReferenceInputs.push(ref.reference);
                continue;
              }

              const relationType = mapRelationType(ref.type);
              const dedupeKey = `${normalizedTargetCanonicalId}:${relationType}`;
              dedupedRows.set(dedupeKey, {
                sourceDocId: payload.docId,
                targetCanonicalId: normalizedTargetCanonicalId,
                relationType,
                extractionConfidence: 1.0,
              });
            }

            if (invalidReferenceInputs.length > 0) {
              yield* Effect.logWarning("indexing.references.invalid", {
                docId: payload.docId,
                versionId: payload.versionId,
                executionId,
                invalidCount: invalidReferenceInputs.length,
                invalidSample: invalidReferenceInputs.slice(0, 10),
              });
            }

            const rows = [...dedupedRows.values()];
            if (rows.length === 0) {
              yield* Effect.logWarning("indexing.references.no-valid-targets", {
                docId: payload.docId,
                versionId: payload.versionId,
                executionId,
                totalParsedReferences: references.length,
              });
              return;
            }

            const targetCanonicalIds = rows.map((row) => row.targetCanonicalId);
            const resolvedTargets = yield* db
              .select({
                docId: legalDocuments.docId,
                canonicalId: legalDocuments.canonicalId,
              })
              .from(legalDocuments)
              .where(inArray(legalDocuments.canonicalId, targetCanonicalIds));

            const targetDocIdByCanonicalId = new Map(
              resolvedTargets.map((target) => [target.canonicalId, target.docId]),
            );

            const rowsWithResolvedTarget = rows.map((row) => ({
              ...row,
              targetDocId: targetDocIdByCanonicalId.get(row.targetCanonicalId) ?? null,
              resolvedAt: targetDocIdByCanonicalId.has(row.targetCanonicalId) ? new Date() : null,
            }));

            // Make the operation idempotent by clearing previous document-level anchors for this doc
            yield* db
              .delete(referenceAnchors)
              .where(
                and(
                  eq(referenceAnchors.sourceDocId, payload.docId),
                  sql`${referenceAnchors.sourceFragmentId} IS NULL`,
                ),
              );

            yield* db.insert(referenceAnchors).values(rowsWithResolvedTarget);
          }).pipe(
            Effect.mapError((cause) =>
              toWorkflowError(
                payload,
                executionId,
                "upsert-references",
                cause,
                "Unable to upsert document references",
              ),
            ),
          ),
      );

      const processFragments = Effect.fn("BoeIndexingActivities.processFragments")(
        (
          payload: IndexingTriggerPayload,
          executionId: string,
          versionData: {
            readonly contentText: string;
            readonly validFrom: Date;
            readonly validUntil: Date | null;
          },
        ) =>
          Effect.gen(function* () {
            // Extract dates here to prevent the massive `versionData` object (and its `contentText` XML)
            // from being captured and retained in the Stream's closure below.
            const validFrom = versionData.validFrom;
            const validUntil = versionData.validUntil;

            const { fragments, references } = yield* parser
              .parseForIndexingWithReferences({ xml: versionData.contentText })
              .pipe(
                Effect.mapError((cause) =>
                  toWorkflowError(
                    payload,
                    executionId,
                    "parse-document",
                    cause,
                    "Unable to parse BOE XML document",
                  ),
                ),
              );

            yield* upsertDocumentReferences(payload, executionId, references);

            yield* Stream.fromIterable(fragments).pipe(
              Stream.map((fragment) =>
                mapNodeToParsedFragment(payload, fragment, { validFrom, validUntil }),
              ),
              Stream.grouped(config.upsertBatchSize),
              Stream.mapEffect(
                (batch) => {
                  const parsedBatch = Chunk.toReadonlyArray(batch);
                  return Effect.gen(function* () {
                    const persistedRows = yield* upsertFragmentBatch(
                      payload,
                      executionId,
                      parsedBatch,
                    );
                    yield* embedFragmentRows(payload, executionId, persistedRows);

                    if (config.profileMemory) {
                      const usage = process.memoryUsage();
                      yield* Effect.logInfo("indexing.fragment.batch.completed", {
                        docId: payload.docId,
                        versionId: payload.versionId,
                        parsedBatchSize: parsedBatch.length,
                        persistedBatchSize: persistedRows.length,
                        rssMb: Math.round(usage.rss / (1024 * 1024)),
                        heapUsedMb: Math.round(usage.heapUsed / (1024 * 1024)),
                      });
                    }
                  });
                },
                { concurrency: 1 },
              ),
              Stream.runDrain,
            );
          }),
      );

      const finalizeReady = Effect.fn("BoeIndexingActivities.finalizeReady")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          db
            .update(fragmentIndexJobs)
            .set({
              status: "ready",
              completedAt: new Date(),
              updatedAt: new Date(),
              lastError: null,
            })
            .where(
              and(
                eq(fragmentIndexJobs.docId, payload.docId),
                eq(fragmentIndexJobs.versionId, payload.versionId),
              ),
            )
            .pipe(
              Effect.mapError((cause) =>
                toWorkflowError(
                  payload,
                  executionId,
                  "finalize-ready",
                  cause,
                  "Unable to mark indexing job as ready",
                ),
              ),
              Effect.asVoid,
            ),
      );

      const finalizeFailed = Effect.fn("BoeIndexingActivities.finalizeFailed")(
        (payload: IndexingTriggerPayload, reason: string) =>
          db
            .update(fragmentIndexJobs)
            .set({
              status: "failed",
              completedAt: new Date(),
              updatedAt: new Date(),
              lastError: reason,
            })
            .where(
              and(
                eq(fragmentIndexJobs.docId, payload.docId),
                eq(fragmentIndexJobs.versionId, payload.versionId),
              ),
            )
            .pipe(
              Effect.asVoid,
              Effect.tapError((cause) =>
                Effect.logError(
                  "BoeIndexingActivities.finalizeFailed could not persist failed status",
                  {
                    docId: payload.docId,
                    versionId: payload.versionId,
                    reason,
                    cause: String(cause),
                  },
                ),
              ),
              Effect.catchAll(() => Effect.void),
            ),
      );

      return {
        markInProgress,
        ensureLatestVersion,
        loadVersionContent,
        processFragments,
        finalizeReady,
        finalizeFailed,
      };
    }),
  },
) {}

function createContentFingerprint(
  docId: string,
  versionId: string,
  nodePath: string,
  normalizedContent: string,
): string {
  return new Bun.CryptoHasher("sha256")
    .update(`${docId}:${versionId}:${nodePath}:${normalizedContent}`)
    .digest("hex");
}

function toWorkflowError(
  payload: IndexingTriggerPayload,
  executionId: string,
  stage: string,
  cause: unknown,
  message: string,
): IndexingWorkflowError {
  return new IndexingWorkflowError({
    runId: payload.runId,
    docId: payload.docId,
    versionId: payload.versionId,
    executionId,
    stage,
    message,
    cause,
  });
}

function formatUnknownCause(cause: unknown): string {
  if (Cause.isCause(cause)) {
    return Cause.pretty(cause, { renderErrorCause: true });
  }
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  return String(cause);
}

function isForeignKeyViolationCause(cause: unknown): boolean {
  const rendered = formatUnknownCause(cause).toLowerCase();
  return rendered.includes("foreign key") || rendered.includes("violates foreign key constraint");
}

function isRetryableTargetCheckError(cause: unknown): boolean {
  return (
    cause instanceof IndexingWorkflowError &&
    cause.stage === "mark-in-progress-target-check" &&
    cause.message.startsWith("Indexing payload references missing")
  );
}

function toTargetCanonicalId(reference: string): string | null {
  const trimmed = reference.trim();
  if (trimmed.length === 0 || /^-+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
