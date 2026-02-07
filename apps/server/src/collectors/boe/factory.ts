import { Cause, Duration, Effect, Exit, Option, Ref, Schema, Stream } from "effect";

import { and, db, eq } from "@canary/db";
import {
  documentVersions,
  legalDocuments,
  legislativeSources,
  syncRuns,
} from "@canary/db/schema/legislation";
import {
  CollectionError,
  SourceConnectionError,
  ValidationError,
} from "~/services/collector/errors";
import { defineFactory, type CollectorRuntime } from "~/services/collector/factory";
import {
  CollectedDocument,
  CollectionBatch,
  CollectionCursor,
  CollectionMode,
  type Capabilities,
  type CollectionMode as CollectionModeType,
  type CollectionRunId,
} from "~/services/collector/schema";

import { BoeCollectorConfig } from "./config";
import { mapBoeLawToDocument, parseBoeDate, parseBoeDateTime } from "./mapping";
import { BoeResponseSchema, normalizeBoeItems, type BoeLawItem } from "./schemas";

const decodeBoeResponse = Schema.decodeUnknown(BoeResponseSchema);
const decodeDateTimeUtc = Schema.decodeSync(Schema.DateTimeUtc);

const capabilities: Capabilities = new Set([
  "FullSync",
  "Incremental",
  "Backfill",
  "Resume",
  "ChangeDetection",
]);

interface SyncStats {
  readonly inserted: number;
  readonly updated: number;
  readonly failed: number;
}

const toMetadataRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
};

const createContentHash = (content: string): string =>
  new Bun.CryptoHasher("sha256").update(content).digest("hex");

const toTextEndpoint = (baseUrl: string, identifier: string): string => {
  const origin = new URL(baseUrl).origin;
  return `${origin}/datosabiertos/api/legislacion-consolidada/id/${identifier}/texto`;
};

const zeroStats: SyncStats = {
  inserted: 0,
  updated: 0,
  failed: 0,
};

const fullSyncMode = CollectionMode.FullSync({
  startDate: undefined,
  batchSize: undefined,
});

const parseResumeOffset = (mode: CollectionModeType): number => {
  if (mode._tag !== "Resume") {
    return 0;
  }

  const parsed = Number.parseInt(mode.cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const collectWindow = (
  mode: CollectionModeType,
): Option.Option<{ readonly from?: Date; readonly to?: Date }> => {
  switch (mode._tag) {
    case "Incremental":
      return Option.some({ from: mode.since });
    case "Backfill":
      return Option.some({ from: mode.from, to: mode.to });
    case "Resume":
      return collectWindow(mode.originalMode);
    default:
      return Option.none();
  }
};

const isWithinModeWindow = (itemUpdatedAt: Date, mode: CollectionModeType): boolean => {
  const window = collectWindow(mode);
  return Option.match(window, {
    onNone: () => true,
    onSome: ({ from, to }) => {
      if (from !== undefined && itemUpdatedAt < from) {
        return false;
      }
      if (to !== undefined && itemUpdatedAt > to) {
        return false;
      }
      return true;
    },
  });
};

export const BoeLawsCollectorFactory = defineFactory({
  id: "boe-laws",
  name: "BOE Laws Collector",
  description: "Collects BOE consolidated legislation and upserts legal document metadata",
  configSchema: BoeCollectorConfig,
  capabilities,
  make: ({ collectorId, config }) => {
    const sourceId = config.sourceId;

    const ensureSourceExists = Effect.fn("BoeCollector.ensureSourceExists")(() =>
      Effect.tryPromise({
        try: async () => {
          const rows = await db
            .select({ sourceId: legislativeSources.sourceId })
            .from(legislativeSources)
            .where(eq(legislativeSources.sourceId, sourceId))
            .limit(1);
          return rows.length > 0;
        },
        catch: (cause) =>
          new CollectionError({
            collectorId,
            runId: undefined,
            reason: "Unable to verify legislative source",
            cause,
            message: `Collection error [${collectorId}]: Unable to verify legislative source`,
          }),
      }).pipe(
        Effect.flatMap((exists) =>
          exists
            ? Effect.void
            : Effect.fail(
                new ValidationError({
                  collectorId,
                  field: "sourceId",
                  value: sourceId,
                  reason: "Legislative source not found",
                  message: `Legislative source '${sourceId}' does not exist`,
                }),
              ),
        ),
      ),
    );

    const fetchPage = Effect.fn("BoeCollector.fetchPage")(
      (offset: number, mode: CollectionModeType) =>
        Effect.gen(function* () {
          const url = new URL(config.baseUrl);
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("limit", String(config.batchSize));

          if (config.staticQuery.trim().length > 0) {
            url.searchParams.set("query", config.staticQuery);
          }

          Option.match(collectWindow(mode), {
            onNone: () => undefined,
            onSome: ({ from, to }) => {
              if (from !== undefined) {
                url.searchParams.set("from", from.toISOString().slice(0, 10).replaceAll("-", ""));
              }
              if (to !== undefined) {
                url.searchParams.set("to", to.toISOString().slice(0, 10).replaceAll("-", ""));
              }
            },
          });

          const payload = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(url, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(config.timeoutMs),
              });

              if (!response.ok) {
                throw new SourceConnectionError({
                  collectorId,
                  sourceUrl: url.toString(),
                  cause: `HTTP ${response.status}`,
                  message: `Cannot reach source '${url}' for collector '${collectorId}'`,
                });
              }

              return response.json();
            },
            catch: (cause) =>
              cause instanceof SourceConnectionError
                ? cause
                : new SourceConnectionError({
                    collectorId,
                    sourceUrl: url.toString(),
                    cause,
                    message: `Cannot reach source '${url}' for collector '${collectorId}'`,
                  }),
          });

          const decoded = yield* decodeBoeResponse(payload).pipe(
            Effect.mapError(
              (cause) =>
                new ValidationError({
                  collectorId,
                  field: "sourcePayload",
                  value: payload,
                  reason: String(cause),
                  message: `Invalid BOE payload for collector '${collectorId}'`,
                }),
            ),
          );

          return normalizeBoeItems(decoded);
        }),
    );

    const fetchConsolidatedText = Effect.fn("BoeCollector.fetchConsolidatedText")(
      (identifier: string, runId: CollectionRunId) =>
        config.ingestTextVersions
          ? Effect.tryPromise({
              try: async () => {
                const sourceUrl = toTextEndpoint(config.baseUrl, identifier);
                const response = await fetch(sourceUrl, {
                  headers: { Accept: "application/xml" },
                  signal: AbortSignal.timeout(config.textRequestTimeoutMs),
                });

                if (!response.ok) {
                  throw new SourceConnectionError({
                    collectorId,
                    sourceUrl,
                    cause: `HTTP ${response.status}`,
                    message: `Cannot reach source '${sourceUrl}' for collector '${collectorId}'`,
                  });
                }

                return response.text();
              },
              catch: (cause) =>
                cause instanceof SourceConnectionError
                  ? cause
                  : new CollectionError({
                      collectorId,
                      runId,
                      reason: `Unable to fetch consolidated text for '${identifier}'`,
                      cause,
                      message: `Collection error [${collectorId}]: Unable to fetch consolidated text for '${identifier}'`,
                    }),
            }).pipe(
              Effect.flatMap((xml) =>
                xml.trim().length > 0
                  ? Effect.succeed(xml)
                  : Effect.fail(
                      new CollectionError({
                        collectorId,
                        runId,
                        reason: `Empty consolidated text for '${identifier}'`,
                        message: `Collection error [${collectorId}]: Empty consolidated text for '${identifier}'`,
                      }),
                    ),
              ),
            )
          : Effect.succeed(""),
    );

    const upsertDocumentVersion = Effect.fn("BoeCollector.upsertDocumentVersion")(
      (input: {
        readonly docId: string;
        readonly contentText: string;
        readonly validFrom: Date;
        readonly kind: "New" | "Update";
        readonly runId: CollectionRunId;
      }) =>
        config.ingestTextVersions
          ? input.contentText.length === 0
            ? Effect.void
            : Effect.tryPromise({
                try: () =>
                  db
                    .select({
                      versionId: documentVersions.versionId,
                      versionNumber: documentVersions.versionNumber,
                    })
                    .from(documentVersions)
                    .where(eq(documentVersions.docId, input.docId)),
                catch: (cause) =>
                  new CollectionError({
                    collectorId,
                    runId: input.runId,
                    reason: "Unable to load document versions",
                    cause,
                    message: `Collection error [${collectorId}]: Unable to load document versions`,
                  }),
              }).pipe(
                Effect.flatMap((existingVersions) => {
                  const latest = existingVersions.reduce<{
                    readonly versionId: string;
                    readonly versionNumber: number;
                  } | null>((acc, item) => {
                    if (acc === null || item.versionNumber > acc.versionNumber) {
                      return item;
                    }
                    return acc;
                  }, null);

                  const nextVersion = latest === null ? 1 : latest.versionNumber + 1;

                  const closePrevious =
                    input.kind === "Update" && latest !== null
                      ? Effect.tryPromise({
                          try: () =>
                            db
                              .update(documentVersions)
                              .set({ validUntil: new Date() })
                              .where(eq(documentVersions.versionId, latest.versionId)),
                          catch: (cause) =>
                            new CollectionError({
                              collectorId,
                              runId: input.runId,
                              reason: "Unable to close previous document version",
                              cause,
                              message: `Collection error [${collectorId}]: Unable to close previous document version`,
                            }),
                        })
                      : Effect.void;

                  const insertNext = Effect.tryPromise({
                    try: () =>
                      db.insert(documentVersions).values({
                        docId: input.docId,
                        versionNumber: nextVersion,
                        versionType:
                          input.kind === "New" ? "consolidated_initial" : "consolidated_update",
                        contentText: input.contentText,
                        validFrom: input.validFrom,
                        validUntil: null,
                      }),
                    catch: (cause) =>
                      new CollectionError({
                        collectorId,
                        runId: input.runId,
                        reason: "Unable to insert document version",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to insert document version`,
                      }),
                  });

                  return closePrevious.pipe(Effect.zipRight(insertNext), Effect.asVoid);
                }),
              )
          : Effect.void,
    );

    const startSyncRun = Effect.fn("BoeCollector.startSyncRun")(
      (runId: CollectionRunId, mode: CollectionModeType) =>
        config.trackSyncRuns
          ? Effect.tryPromise({
              try: () =>
                db
                  .insert(syncRuns)
                  .values({
                    runId,
                    sourceId,
                    status: "running",
                    startedAt: new Date(),
                    docsInserted: 0,
                    docsUpdated: 0,
                    docsFailed: 0,
                    metadata: {
                      collectorId,
                      factoryId: "boe-laws",
                      mode: mode._tag,
                    },
                  })
                  .onConflictDoUpdate({
                    target: syncRuns.runId,
                    set: {
                      status: "running",
                      completedAt: null,
                      docsInserted: 0,
                      docsUpdated: 0,
                      docsFailed: 0,
                      durationMs: null,
                      errorLog: [],
                      metadata: {
                        collectorId,
                        factoryId: "boe-laws",
                        mode: mode._tag,
                      },
                    },
                  }),
              catch: (cause) =>
                new CollectionError({
                  collectorId,
                  runId,
                  reason: "Unable to start sync run",
                  cause,
                  message: `Collection error [${collectorId}]: Unable to start sync run`,
                }),
            })
          : Effect.void,
    );

    const finishSyncRun = Effect.fn("BoeCollector.finishSyncRun")(
      (input: {
        readonly runId: CollectionRunId;
        readonly status: "completed" | "failed";
        readonly stats: SyncStats;
        readonly startedAt: Date;
        readonly errorLog: ReadonlyArray<Record<string, string>>;
      }) =>
        config.trackSyncRuns
          ? Effect.tryPromise({
              try: () =>
                db
                  .update(syncRuns)
                  .set({
                    status: input.status,
                    completedAt: new Date(),
                    docsInserted: input.stats.inserted,
                    docsUpdated: input.stats.updated,
                    docsFailed: input.stats.failed,
                    durationMs: Date.now() - input.startedAt.getTime(),
                    errorLog: input.errorLog,
                  })
                  .where(eq(syncRuns.runId, input.runId)),
              catch: (cause) =>
                new CollectionError({
                  collectorId,
                  runId: input.runId,
                  reason: "Unable to finalize sync run",
                  cause,
                  message: `Collection error [${collectorId}]: Unable to finalize sync run`,
                }),
            })
          : Effect.void,
    );

    const upsertLaw = Effect.fn("BoeCollector.upsertLaw")(
      (law: BoeLawItem, runId: CollectionRunId) =>
        Effect.gen(function* () {
          const mapped = yield* Effect.try({
            try: () =>
              mapBoeLawToDocument(law, {
                sourceId,
                actor: config.upsertActor,
                unknownRangeStrategy: config.unknownRangeStrategy,
              }),
            catch: (cause) =>
              new ValidationError({
                collectorId,
                field: "mapping",
                value: law,
                reason: String(cause),
                message: `Failed to map BOE law '${law.identificador}'`,
              }),
          });

          const existingRows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  docId: legalDocuments.docId,
                  firstSeenAt: legalDocuments.firstSeenAt,
                  officialTitle: legalDocuments.officialTitle,
                  metadataHash: legalDocuments.metadataHash,
                  lastUpdatedAt: legalDocuments.lastUpdatedAt,
                  contentHash: legalDocuments.contentHash,
                })
                .from(legalDocuments)
                .where(
                  and(
                    eq(legalDocuments.canonicalId, mapped.canonicalId),
                    eq(legalDocuments.sourceId, sourceId),
                  ),
                )
                .limit(1),
            catch: (cause) =>
              new CollectionError({
                collectorId,
                runId,
                reason: "Unable to load existing document",
                cause,
                message: `Collection error [${collectorId}]: Unable to load existing document`,
              }),
          });
          const existing = existingRows[0] ?? null;

          const unchangedByMetadata =
            existing !== null &&
            existing.officialTitle === mapped.document.officialTitle &&
            existing.metadataHash === mapped.metadataHash &&
            existing.lastUpdatedAt?.getTime() === mapped.document.lastUpdatedAt?.getTime();

          if (unchangedByMetadata) {
            return {
              kind: "Unchanged" as const,
              mapped,
              contentText: "",
              contentHash: existing.contentHash,
            };
          }

          const contentText = config.ingestTextVersions
            ? yield* fetchConsolidatedText(law.identificador, runId)
            : "";
          const contentHash = config.ingestTextVersions ? createContentHash(contentText) : null;
          const documentValues = {
            ...mapped.document,
            contentHash,
          };

          if (existing === null) {
            return yield* Effect.tryPromise({
              try: () =>
                db
                  .insert(legalDocuments)
                  .values(documentValues)
                  .returning({ docId: legalDocuments.docId }),
              catch: (cause) =>
                new CollectionError({
                  collectorId,
                  runId,
                  reason: "Unable to insert legal document",
                  cause,
                  message: `Collection error [${collectorId}]: Unable to insert legal document`,
                }),
            }).pipe(
              Effect.flatMap((insertedRows) => {
                const inserted = insertedRows[0];
                if (inserted === undefined) {
                  return Effect.fail(
                    new CollectionError({
                      collectorId,
                      runId,
                      reason: "Insert did not return docId",
                      message: `Collection error [${collectorId}]: Insert did not return docId`,
                    }),
                  );
                }

                return upsertDocumentVersion({
                  docId: inserted.docId,
                  contentText,
                  validFrom:
                    documentValues.entryIntoForceAt ?? documentValues.publishedAt ?? new Date(),
                  kind: "New",
                  runId,
                }).pipe(
                  Effect.as({
                    kind: "New" as const,
                    mapped: {
                      ...mapped,
                      document: documentValues,
                    },
                    contentText,
                    contentHash,
                  }),
                );
              }),
            );
          }

          return yield* Effect.tryPromise({
            try: () =>
              db
                .update(legalDocuments)
                .set({
                  ...documentValues,
                  firstSeenAt: existing.firstSeenAt ?? documentValues.firstSeenAt,
                })
                .where(eq(legalDocuments.docId, existing.docId)),
            catch: (cause) =>
              new CollectionError({
                collectorId,
                runId,
                reason: "Unable to update legal document",
                cause,
                message: `Collection error [${collectorId}]: Unable to update legal document`,
              }),
          }).pipe(
            Effect.zipRight(
              upsertDocumentVersion({
                docId: existing.docId,
                contentText,
                validFrom:
                  documentValues.entryIntoForceAt ?? documentValues.publishedAt ?? new Date(),
                kind: "Update",
                runId,
              }),
            ),
            Effect.as({
              kind: "Update" as const,
              mapped: {
                ...mapped,
                document: documentValues,
              },
              contentText,
              contentHash,
            }),
          );
        }),
    );

    const buildDocument = (
      law: BoeLawItem,
      kind: CollectedDocument["kind"],
      mappedMetadata: unknown,
      contentText: string,
      contentHash: string | null,
    ) =>
      new CollectedDocument({
        externalId: `boe:${law.identificador}`,
        title: law.titulo,
        content: contentText,
        metadata: toMetadataRecord(mappedMetadata),
        publishedAt: decodeDateTimeUtc(parseBoeDate(law.fecha_publicacion).toISOString()),
        updatedAt: Option.some(
          decodeDateTimeUtc(parseBoeDateTime(law.fecha_actualizacion).toISOString()),
        ),
        sourceUrl: Option.some(law.url_html_consolidada),
        contentHash: Option.fromNullable(contentHash),
        kind,
      });

    const collectStream = (mode: CollectionModeType, runId: CollectionRunId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* ensureSourceExists();

          const startedAt = new Date();
          const statsRef = yield* Ref.make(zeroStats);
          const errorLogRef = yield* Ref.make<Array<Record<string, string>>>([]);

          yield* startSyncRun(runId, mode);

          const appendErrorLog = (entry: Record<string, string>) =>
            Ref.update(errorLogRef, (entries) => [...entries, entry]);

          const stream = Stream.unfoldEffect(
            { offset: parseResumeOffset(mode), done: false },
            (state: { readonly offset: number; readonly done: boolean }) =>
              state.done
                ? Effect.succeed(Option.none())
                : Effect.gen(function* () {
                    const page = yield* fetchPage(state.offset, mode);
                    if (page.length === 0) {
                      return Option.none();
                    }

                    const documents: CollectedDocument[] = [];
                    let inserted = 0;
                    let updated = 0;
                    let failed = 0;

                    for (const law of page) {
                      const includeInWindow = yield* Effect.try({
                        try: () =>
                          isWithinModeWindow(parseBoeDateTime(law.fecha_actualizacion), mode),
                        catch: (cause) =>
                          new ValidationError({
                            collectorId,
                            field: "fecha_actualizacion",
                            value: law.fecha_actualizacion,
                            reason: String(cause),
                            message: `Invalid BOE update timestamp for '${law.identificador}'`,
                          }),
                      }).pipe(
                        Effect.catchTag("ValidationError", (error) => {
                          if (config.unknownRangeStrategy === "fail") {
                            return Effect.fail(error);
                          }

                          failed += 1;
                          return appendErrorLog({
                            identifier: law.identificador,
                            tag: error._tag,
                            message: error.message,
                          }).pipe(Effect.as(false));
                        }),
                      );

                      if (!includeInWindow) {
                        continue;
                      }

                      const result = yield* upsertLaw(law, runId).pipe(
                        Effect.catchTag("ValidationError", (error) => {
                          if (config.unknownRangeStrategy === "fail") {
                            return Effect.fail(error);
                          }

                          failed += 1;
                          return appendErrorLog({
                            identifier: law.identificador,
                            tag: error._tag,
                            message: error.message,
                          }).pipe(Effect.as(null));
                        }),
                      );

                      if (result === null) {
                        continue;
                      }

                      if (result.kind === "New") {
                        inserted += 1;
                      } else if (result.kind === "Update") {
                        updated += 1;
                      }

                      const document = yield* Effect.try({
                        try: () =>
                          buildDocument(
                            law,
                            result.kind,
                            result.mapped.document.rawMetadata,
                            result.contentText,
                            result.contentHash,
                          ),
                        catch: (cause) =>
                          new ValidationError({
                            collectorId,
                            field: "documentEncoding",
                            value: law.identificador,
                            reason: String(cause),
                            message: `Failed to build collected document for '${law.identificador}'`,
                          }),
                      }).pipe(
                        Effect.catchTag("ValidationError", (error) => {
                          if (config.unknownRangeStrategy === "fail") {
                            return Effect.fail(error);
                          }

                          failed += 1;
                          return appendErrorLog({
                            identifier: law.identificador,
                            tag: error._tag,
                            message: error.message,
                          }).pipe(Effect.as(null));
                        }),
                      );

                      if (document !== null) {
                        documents.push(document);
                      }
                    }

                    yield* Ref.update(statsRef, (stats) => ({
                      inserted: stats.inserted + inserted,
                      updated: stats.updated + updated,
                      failed: stats.failed + failed,
                    }));

                    const hasMore = page.length === config.batchSize;
                    const nextOffset = state.offset + config.batchSize;

                    if (hasMore && config.requestDelayMs > 0) {
                      yield* Effect.sleep(Duration.millis(config.requestDelayMs));
                    }

                    return Option.some([
                      new CollectionBatch({
                        documents,
                        cursor: Option.some(
                          new CollectionCursor({
                            value: String(nextOffset),
                            displayLabel: Option.none(),
                          }),
                        ),
                        hasMore,
                      }),
                      { offset: nextOffset, done: !hasMore },
                    ] as const);
                  }),
          );

          return stream.pipe(
            Stream.ensuringWith((exit) =>
              Effect.gen(function* () {
                const stats = yield* Ref.get(statsRef);
                const errorLog = yield* Ref.get(errorLogRef);
                const isSuccess = Exit.isSuccess(exit);

                const finalErrorLog = isSuccess
                  ? errorLog
                  : [
                      ...errorLog,
                      {
                        collectorId,
                        tag: "CollectionExit",
                        message: Cause.pretty(exit.cause),
                      },
                    ];

                yield* finishSyncRun({
                  runId,
                  status: isSuccess ? "completed" : "failed",
                  stats,
                  startedAt,
                  errorLog: finalErrorLog,
                }).pipe(Effect.catchTag("CollectionError", () => Effect.void));
              }),
            ),
          );
        }),
      );

    const collectorRuntime: CollectorRuntime = {
      collect: (mode, runId) =>
        collectStream(mode, runId).pipe(Stream.withSpan("BoeCollector.collectStream")),
      validate: ensureSourceExists().pipe(
        Effect.zipRight(fetchPage(0, fullSyncMode)),
        Effect.asVoid,
      ),
      detectChanges: (since) =>
        fetchPage(
          0,
          CollectionMode.Incremental({
            since,
            lookBackWindow: undefined,
          }),
        ).pipe(Effect.map((items) => items.length > 0)),
      estimateTotal: () => Effect.succeed(Option.none()),
      healthCheck: fetchPage(0, fullSyncMode).pipe(
        Effect.as({ status: "healthy" as const, checkedAt: new Date() }),
        Effect.catchTags({
          SourceConnectionError: (error) =>
            Effect.succeed({
              status: "unhealthy" as const,
              checkedAt: new Date(),
              message: error.message,
            }),
          ValidationError: (error) =>
            Effect.succeed({
              status: "unhealthy" as const,
              checkedAt: new Date(),
              message: error.message,
            }),
        }),
      ),
    };

    return Effect.succeed(collectorRuntime);
  },
});
