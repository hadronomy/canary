import { Effect, Schema } from "effect";

import { and, eq, sql } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
import {
  documentVersions,
  fragmentIndexJobs,
  nodeTypeEnum,
  senseFragments,
} from "@canary/db/schema/legislation";
import { astNodePaths, BoeXmlParser } from "~/collectors/boe/parser";
import { EmbeddingService, EmbeddingServiceLive } from "~/services/embedding";

import { IndexingWorkflowError } from "./errors";
import type { IndexingTriggerPayload } from "./schema";

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

const EMBEDDING_BATCH_SIZE = 32;

export class BoeIndexingActivities extends Effect.Service<BoeIndexingActivities>()(
  "BoeIndexingActivities",
  {
    accessors: true,
    dependencies: [DatabaseService.Default, BoeXmlParser.Default, EmbeddingServiceLive],
    effect: Effect.gen(function* () {
      const db = yield* DatabaseService.client();
      const parser = yield* BoeXmlParser;
      const embedding = yield* EmbeddingService;

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

      const parseDocument = Effect.fn("BoeIndexingActivities.parseDocument")(
        (payload: IndexingTriggerPayload, executionId: string, xml: string) =>
          Effect.gen(function* () {
            const parsed = yield* parser
              .parse({ xml })
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

            return parsed.ast.nodes.map((node) => {
              const paths = astNodePaths(node);
              return {
                content: node.content,
                contentNormalized: node.contentNormalized,
                nodePath: String(node.nodePath),
                nodePathLtree: String(paths.nodePathLtree),
                legalNodePathLtree:
                  paths.legalNodePathLtree === undefined ? null : String(paths.legalNodePathLtree),
                nodeType: node.nodeType,
                nodeNumber: node.nodeNumber ?? null,
                nodeTitle: node.nodeTitle ?? null,
                precedingContext: node.precedingContext ?? null,
                followingContext: node.followingContext ?? null,
                sequenceIndex: node.sequenceIndex,
                contentFingerprint: createContentFingerprint(
                  payload.docId,
                  payload.versionId,
                  String(node.nodePath),
                  node.contentNormalized,
                ),
              } satisfies ParsedFragment;
            });
          }),
      );

      const upsertFragments = Effect.fn("BoeIndexingActivities.upsertFragments")(
        (
          payload: IndexingTriggerPayload,
          executionId: string,
          parsedFragments: ReadonlyArray<ParsedFragment>,
        ) =>
          Effect.gen(function* () {
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

            if (rows.length === 0) {
              return [] as ReadonlyArray<FragmentRow>;
            }

            const persistedRows = yield* db
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

            return persistedRows;
          }),
      );

      const embedFragments = Effect.fn("BoeIndexingActivities.embedFragments")(
        (payload: IndexingTriggerPayload, executionId: string, rows: ReadonlyArray<FragmentRow>) =>
          Effect.gen(function* () {
            if (rows.length === 0) {
              return;
            }

            const buffered: Array<ReadonlyArray<FragmentRow>> = [];
            for (let index = 0; index < rows.length; index += EMBEDDING_BATCH_SIZE) {
              buffered.push(rows.slice(index, index + EMBEDDING_BATCH_SIZE));
            }

            yield* Effect.forEach(
              buffered,
              (batch) =>
                Effect.gen(function* () {
                  const vectors = yield* embedding.embed(batch.map((row) => row.content)).pipe(
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

                  if (!Array.isArray(vectors) || vectors.length !== batch.length) {
                    return yield* toWorkflowError(
                      payload,
                      executionId,
                      "embed-fragments",
                      undefined,
                      "Embedding service returned unexpected vector cardinality",
                    );
                  }

                  yield* Effect.forEach(
                    batch,
                    (row, index) => {
                      const vector = vectors[index];
                      if (vector === undefined) {
                        return Effect.void;
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
                    { discard: true, concurrency: 4 },
                  );
                }),
              { discard: true, concurrency: 1 },
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
              Effect.catchAll(() => Effect.void),
            ),
      );

      return {
        markInProgress,
        ensureLatestVersion,
        loadVersionContent,
        parseDocument,
        upsertFragments,
        embedFragments,
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
