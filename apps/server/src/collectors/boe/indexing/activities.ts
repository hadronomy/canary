import { Chunk, Config, Effect, Schema, Stream } from "effect";

import { and, eq, sql } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
import {
  documentVersions,
  fragmentIndexJobs,
  nodeTypeEnum,
  senseFragments,
} from "@canary/db/schema/legislation";
import {
  BoeXmlParser,
  legalNodePathToLtree,
  nodePathToLtree,
  type BoeFragment,
} from "~/collectors/boe/parser";
import { EmbeddingService, EmbeddingServiceLive } from "~/services/embedding";

import { IndexingWorkflowError } from "./errors";
import type { IndexingTriggerPayload } from "./schema";

const IndexingConfig = Config.all({
  dbUpdateConcurrency: Config.number("DB_UPDATE_CONCURRENCY").pipe(Config.withDefault(4)),
  upsertBatchSize: Config.number("INDEXING_UPSERT_BATCH_SIZE").pipe(Config.withDefault(250)),
  embedBatchSize: Config.number("INDEXING_EMBED_BATCH_SIZE").pipe(Config.withDefault(64)),
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

      const markInProgress = Effect.fn("BoeIndexingActivities.markInProgress")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          db
            .insert(fragmentIndexJobs)
            .values({
              docId: payload.docId,
              versionId: payload.versionId,
              status: "in_progress",
              attempts: 1,
              metadata: {
                runId: payload.runId,
                executionId,
                canonicalId: payload.canonicalId,
                contentHash: payload.contentHash,
                requestedAt: payload.requestedAt,
                kind: payload.kind,
              },
            })
            .onConflictDoUpdate({
              target: [fragmentIndexJobs.docId, fragmentIndexJobs.versionId],
              set: {
                status: "in_progress",
                attempts: sql`${fragmentIndexJobs.attempts} + 1`,
                updatedAt: sql`now()`,
                lastError: null,
                metadata: {
                  runId: payload.runId,
                  executionId,
                  canonicalId: payload.canonicalId,
                  contentHash: payload.contentHash,
                  requestedAt: payload.requestedAt,
                  kind: payload.kind,
                },
              },
            })
            .pipe(
              Effect.mapError((cause) =>
                toWorkflowError(
                  payload,
                  executionId,
                  "mark-in-progress",
                  cause,
                  "Unable to mark indexing job in progress",
                ),
              ),
              Effect.asVoid,
            ),
      );

      const loadVersionContent = Effect.fn("BoeIndexingActivities.loadVersionContent")(
        (payload: IndexingTriggerPayload, executionId: string) =>
          db
            .select({ contentText: documentVersions.contentText })
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
                const content = rows[0]?.contentText;
                if (content === undefined || content === null || content.trim().length === 0) {
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
                return Effect.succeed(content);
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

      const embedFragmentRows = Effect.fn("BoeIndexingActivities.embedFragmentRows")(
        (payload: IndexingTriggerPayload, executionId: string, rows: ReadonlyArray<FragmentRow>) =>
          Stream.fromIterable(rows).pipe(
            Stream.grouped(config.embedBatchSize),
            Stream.mapEffect(
              (batch) => {
                const batchRows = Chunk.toReadonlyArray(batch);
                return Effect.gen(function* () {
                  const vectors = yield* embedding
                    .embed(batchRows.map((row) => row.content))
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

                  yield* Effect.forEach(
                    batchRows,
                    (row, index) => {
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

                      return db
                        .update(senseFragments)
                        .set({
                          embedding1024: vector.full,
                          embedding256: vector.scout,
                          updatedAt: new Date(),
                        })
                        .where(eq(senseFragments.fragmentId, row.fragmentId))
                        .pipe(
                          Effect.mapError((cause) =>
                            toWorkflowError(
                              payload,
                              executionId,
                              "embed-fragments",
                              cause,
                              "Unable to persist generated fragment embedding",
                            ),
                          ),
                          Effect.asVoid,
                        );
                    },
                    { discard: true, concurrency: config.dbUpdateConcurrency },
                  );

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
              { concurrency: 1 },
            ),
            Stream.runDrain,
          ),
      );

      const processFragments = Effect.fn("BoeIndexingActivities.processFragments")(
        (payload: IndexingTriggerPayload, executionId: string, xml: string) =>
          Effect.gen(function* () {
            const fragments = yield* parser
              .parseForIndexing({ xml })
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

            yield* Stream.fromIterable(fragments).pipe(
              Stream.map((fragment) => mapNodeToParsedFragment(payload, fragment)),
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
