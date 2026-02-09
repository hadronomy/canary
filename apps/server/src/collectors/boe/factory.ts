import { Cause, Duration, Effect, Exit, Option, Ref, Schedule, Schema, Stream } from "effect";

import { and, eq, inArray, sql } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
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

interface ExistingLegalDocument {
  readonly docId: string;
  readonly canonicalId: string;
  readonly firstSeenAt: Date | null;
  readonly officialTitle: string;
  readonly metadataHash: string | null;
  readonly lastUpdatedAt: Date | null;
  readonly contentHash: string | null;
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

const isFullSyncLike = (mode: CollectionModeType): boolean => {
  if (mode._tag === "FullSync") {
    return true;
  }
  if (mode._tag === "Resume") {
    return isFullSyncLike(mode.originalMode);
  }
  return false;
};

const shouldFailFastOnSourceError = (mode: CollectionModeType): boolean => {
  if (mode._tag === "Incremental") {
    return true;
  }
  if (mode._tag === "Resume") {
    return shouldFailFastOnSourceError(mode.originalMode);
  }
  return false;
};

export const BoeLawsCollectorFactory = defineFactory({
  id: "boe-laws",
  name: "BOE Laws Collector",
  description: "Collects BOE consolidated legislation and upserts legal document metadata",
  configSchema: BoeCollectorConfig,
  capabilities,
  make: ({ collectorId, config }) =>
    Effect.gen(function* () {
      const db = yield* DatabaseService.client();

      const sourceId = config.sourceId;
      const requestTimeout = config.timeout;
      const requestDelay = config.requestDelay;
      const textRetryBaseDelay = config.textRetryBase;
      const textRequestTimeout = config.textRequestTimeout;

      const retryPolicy = (attempts: number, baseDelay: Duration.DurationInput) =>
        Schedule.intersect(
          Schedule.recurs(Math.max(0, attempts - 1)),
          Schedule.exponential(baseDelay).pipe(Schedule.jittered),
        );

      const ensureSourceExists = Effect.fn("BoeCollector.ensureSourceExists")(() =>
        Effect.gen(function* () {
          const rows = yield* db
            .select({ sourceId: legislativeSources.sourceId })
            .from(legislativeSources)
            .where(eq(legislativeSources.sourceId, sourceId))
            .limit(1)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CollectionError({
                    collectorId,
                    runId: undefined,
                    reason: "Unable to verify legislative source",
                    cause,
                    message: `Collection error [${collectorId}]: Unable to verify legislative source`,
                  }),
              ),
            );

          return yield* rows.length > 0
            ? Effect.void
            : Effect.fail(
                new ValidationError({
                  collectorId,
                  field: "sourceId",
                  value: sourceId,
                  reason: "Legislative source not found",
                  message: `Legislative source '${sourceId}' does not exist`,
                }),
              );
        }),
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
            }).pipe(
              Effect.timeout(requestTimeout),
              Effect.catchTag("TimeoutException", (timeoutError) =>
                Effect.fail(
                  new SourceConnectionError({
                    collectorId,
                    sourceUrl: url.toString(),
                    cause: timeoutError,
                    message: `Cannot reach source '${url}' for collector '${collectorId}'`,
                  }),
                ),
              ),
              Effect.retry({
                schedule: retryPolicy(config.textFetchMaxAttempts, textRetryBaseDelay),
                while: (error): error is SourceConnectionError =>
                  error._tag === "SourceConnectionError",
              }),
            );

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
            ? Effect.gen(function* () {
                const sourceUrl = toTextEndpoint(config.baseUrl, identifier);

                const fetchOnce = Effect.tryPromise({
                  try: async () => {
                    const response = await fetch(sourceUrl, {
                      headers: { Accept: "application/xml" },
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
                  Effect.timeout(textRequestTimeout),
                  Effect.catchTag("TimeoutException", (timeoutError) =>
                    Effect.fail(
                      new SourceConnectionError({
                        collectorId,
                        sourceUrl,
                        cause: timeoutError,
                        message: `Cannot reach source '${sourceUrl}' for collector '${collectorId}'`,
                      }),
                    ),
                  ),
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
                );

                return yield* fetchOnce.pipe(
                  Effect.retry({
                    schedule: retryPolicy(config.textFetchMaxAttempts, textRetryBaseDelay),
                    while: (error): error is SourceConnectionError =>
                      error._tag === "SourceConnectionError",
                  }),
                );
              })
            : Effect.succeed(""),
      );

      interface PreparedLaw {
        readonly law: BoeLawItem;
        readonly mapped: ReturnType<typeof mapBoeLawToDocument>;
        readonly existing: ExistingLegalDocument | null;
        readonly kind: "New" | "Update" | "Unchanged";
        readonly contentText: string;
        readonly contentHash: string | null;
      }

      const prepareLaw = Effect.fn("BoeCollector.prepareLaw")(
        (law: BoeLawItem, runId: CollectionRunId, existing: ExistingLegalDocument | null) =>
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

            const unchangedByMetadata =
              existing !== null &&
              existing.officialTitle === mapped.document.officialTitle &&
              existing.metadataHash === mapped.metadataHash &&
              existing.lastUpdatedAt?.getTime() === mapped.document.lastUpdatedAt?.getTime();

            if (unchangedByMetadata) {
              return {
                law,
                mapped,
                existing,
                kind: "Unchanged" as const,
                contentText: "",
                contentHash: existing.contentHash,
              };
            }

            const contentText = config.ingestTextVersions
              ? yield* fetchConsolidatedText(law.identificador, runId)
              : "";
            const contentHash = config.ingestTextVersions ? createContentHash(contentText) : null;

            return {
              law,
              mapped,
              existing,
              kind: existing === null ? ("New" as const) : ("Update" as const),
              contentText,
              contentHash,
            };
          }),
      );

      const startSyncRun = Effect.fn("BoeCollector.startSyncRun")(
        (runId: CollectionRunId, mode: CollectionModeType) =>
          config.trackSyncRuns
            ? db
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
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new CollectionError({
                        collectorId,
                        runId,
                        reason: "Unable to start sync run",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to start sync run`,
                      }),
                  ),
                )
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
            ? db
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
                .where(eq(syncRuns.runId, input.runId))
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new CollectionError({
                        collectorId,
                        runId: input.runId,
                        reason: "Unable to finalize sync run",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to finalize sync run`,
                      }),
                  ),
                )
            : Effect.void,
      );

      const canonicalIdFromIdentifier = (identifier: string): string => `boe:${identifier}`;

      const loadExistingDocuments = Effect.fn("BoeCollector.loadExistingDocuments")(
        (page: ReadonlyArray<BoeLawItem>, runId: CollectionRunId) =>
          Effect.gen(function* () {
            const canonicalIds = Array.from(
              new Set(page.map((law) => canonicalIdFromIdentifier(law.identificador))),
            );

            if (canonicalIds.length === 0) {
              return new Map<string, ExistingLegalDocument>();
            }

            const rows = yield* db
              .select({
                docId: legalDocuments.docId,
                canonicalId: legalDocuments.canonicalId,
                firstSeenAt: legalDocuments.firstSeenAt,
                officialTitle: legalDocuments.officialTitle,
                metadataHash: legalDocuments.metadataHash,
                lastUpdatedAt: legalDocuments.lastUpdatedAt,
                contentHash: legalDocuments.contentHash,
              })
              .from(legalDocuments)
              .where(
                and(
                  eq(legalDocuments.sourceId, sourceId),
                  inArray(legalDocuments.canonicalId, canonicalIds),
                ),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CollectionError({
                      collectorId,
                      runId,
                      reason: "Unable to load existing page documents",
                      cause,
                      message: `Collection error [${collectorId}]: Unable to load existing page documents`,
                    }),
                ),
              );

            return new Map<string, ExistingLegalDocument>(
              rows.map((row) => [row.canonicalId, row]),
            );
          }),
      );

      const persistPreparedLaws = Effect.fn("BoeCollector.persistPreparedLaws")(
        (preparedLaws: ReadonlyArray<PreparedLaw>, runId: CollectionRunId) =>
          Effect.gen(function* () {
            const persistable = preparedLaws.filter((law) => law.kind !== "Unchanged");
            if (persistable.length === 0) {
              return;
            }

            const now = new Date();

            const upsertRows = persistable.map((item) => {
              const documentValues = {
                ...item.mapped.document,
                contentHash: item.contentHash,
              };

              return {
                ...documentValues,
                firstSeenAt: item.existing?.firstSeenAt ?? documentValues.firstSeenAt,
              };
            });

            const upserted = yield* db
              .insert(legalDocuments)
              .values(upsertRows)
              .onConflictDoUpdate({
                target: legalDocuments.canonicalId,
                set: {
                  sourceId: sql`excluded.source_id`,
                  eliUri: sql`excluded.eli_uri`,
                  contentType: sql`excluded.content_type`,
                  legislativeStage: sql`excluded.legislative_stage`,
                  hierarchyLevel: sql`excluded.hierarchy_level`,
                  officialTitle: sql`excluded.official_title`,
                  draftNumber: sql`excluded.draft_number`,
                  proceduralStatus: sql`excluded.procedural_status`,
                  introducedAt: sql`excluded.introduced_at`,
                  publishedAt: sql`excluded.published_at`,
                  entryIntoForceAt: sql`excluded.entry_into_force_at`,
                  repealedAt: sql`excluded.repealed_at`,
                  isConsolidatedText: sql`excluded.is_consolidated_text`,
                  consolidationDate: sql`excluded.consolidation_date`,
                  bulletinSection: sql`excluded.bulletin_section`,
                  bulletinPage: sql`excluded.bulletin_page`,
                  originalTextUrl: sql`excluded.original_text_url`,
                  enactedTextUrl: sql`excluded.enacted_text_url`,
                  rawMetadata: sql`excluded.raw_metadata`,
                  department: sql`excluded.department`,
                  proposerName: sql`excluded.proposer_name`,
                  contentHash: sql`excluded.content_hash`,
                  metadataHash: sql`excluded.metadata_hash`,
                  lastUpdatedAt: sql`excluded.last_updated_at`,
                  updatedBy: sql`excluded.updated_by`,
                },
              })
              .returning({
                docId: legalDocuments.docId,
                canonicalId: legalDocuments.canonicalId,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CollectionError({
                      collectorId,
                      runId,
                      reason: "Unable to bulk upsert legal documents",
                      cause,
                      message: `Collection error [${collectorId}]: Unable to bulk upsert legal documents`,
                    }),
                ),
              );

            const docIdByCanonicalId = new Map(upserted.map((row) => [row.canonicalId, row.docId]));

            if (!config.ingestTextVersions) {
              return;
            }

            const newVersionRows: Array<{
              readonly docId: string;
              readonly versionNumber: number;
              readonly versionType: "consolidated_initial";
              readonly contentText: string;
              readonly validFrom: Date;
              readonly validUntil: null;
            }> = [];

            const updateCandidates: Array<{
              readonly docId: string;
              readonly validFrom: Date;
              readonly contentText: string;
            }> = [];

            for (const item of persistable) {
              if (item.contentText.length === 0) {
                continue;
              }

              const canonicalId = item.mapped.canonicalId;
              const docId = docIdByCanonicalId.get(canonicalId);
              if (docId === undefined) {
                return yield* new CollectionError({
                  collectorId,
                  runId,
                  reason: `Bulk upsert did not return docId for '${canonicalId}'`,
                  message: `Collection error [${collectorId}]: Bulk upsert did not return docId for '${canonicalId}'`,
                });
              }

              const validFrom =
                item.mapped.document.entryIntoForceAt ?? item.mapped.document.publishedAt ?? now;

              if (item.kind === "New") {
                newVersionRows.push({
                  docId,
                  versionNumber: 1,
                  versionType: "consolidated_initial",
                  contentText: item.contentText,
                  validFrom,
                  validUntil: null,
                });
              } else {
                updateCandidates.push({ docId, validFrom, contentText: item.contentText });
              }
            }

            if (newVersionRows.length > 0) {
              yield* db
                .insert(documentVersions)
                .values(newVersionRows)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new CollectionError({
                        collectorId,
                        runId,
                        reason: "Unable to bulk insert initial versions",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to bulk insert initial versions`,
                      }),
                  ),
                );
            }

            if (updateCandidates.length === 0) {
              return;
            }

            const updateDocIds = updateCandidates.map((candidate) => candidate.docId);
            const existingVersions = yield* db
              .select({
                versionId: documentVersions.versionId,
                docId: documentVersions.docId,
                versionNumber: documentVersions.versionNumber,
              })
              .from(documentVersions)
              .where(inArray(documentVersions.docId, updateDocIds))
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CollectionError({
                      collectorId,
                      runId,
                      reason: "Unable to load versions for batch updates",
                      cause,
                      message: `Collection error [${collectorId}]: Unable to load versions for batch updates`,
                    }),
                ),
              );

            const latestByDocId = new Map<
              string,
              { readonly versionId: string; readonly versionNumber: number }
            >();
            for (const row of existingVersions) {
              const current = latestByDocId.get(row.docId);
              if (current === undefined || row.versionNumber > current.versionNumber) {
                latestByDocId.set(row.docId, {
                  versionId: row.versionId,
                  versionNumber: row.versionNumber,
                });
              }
            }

            const versionIdsToClose = Array.from(latestByDocId.values()).map(
              (version) => version.versionId,
            );
            if (versionIdsToClose.length > 0) {
              yield* db
                .update(documentVersions)
                .set({ validUntil: now })
                .where(inArray(documentVersions.versionId, versionIdsToClose))
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new CollectionError({
                        collectorId,
                        runId,
                        reason: "Unable to close existing versions in bulk",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to close existing versions in bulk`,
                      }),
                  ),
                );
            }

            const updateVersionRows = updateCandidates.map((candidate) => {
              const latest = latestByDocId.get(candidate.docId);
              return {
                docId: candidate.docId,
                versionNumber: (latest?.versionNumber ?? 0) + 1,
                versionType: "consolidated_update" as const,
                contentText: candidate.contentText,
                validFrom: candidate.validFrom,
                validUntil: null,
              };
            });

            if (updateVersionRows.length > 0) {
              yield* db
                .insert(documentVersions)
                .values(updateVersionRows)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new CollectionError({
                        collectorId,
                        runId,
                        reason: "Unable to bulk insert update versions",
                        cause,
                        message: `Collection error [${collectorId}]: Unable to bulk insert update versions`,
                      }),
                  ),
                );
            }
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

                      const existingByCanonicalId = yield* loadExistingDocuments(page, runId);

                      const outcomes = yield* Effect.forEach(
                        page,
                        (law) =>
                          Effect.gen(function* () {
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

                                return appendErrorLog({
                                  identifier: law.identificador,
                                  tag: error._tag,
                                  message: error.message,
                                }).pipe(Effect.as(false));
                              }),
                            );

                            if (!includeInWindow) {
                              return {
                                prepared: null as PreparedLaw | null,
                                inserted: 0,
                                updated: 0,
                                failed: 0,
                                document: null as CollectedDocument | null,
                              };
                            }

                            const existing = existingByCanonicalId.get(
                              canonicalIdFromIdentifier(law.identificador),
                            );

                            const prepared = yield* prepareLaw(law, runId, existing ?? null).pipe(
                              Effect.catchTags({
                                ValidationError: (error) => {
                                  if (config.unknownRangeStrategy === "fail") {
                                    return Effect.fail(error);
                                  }

                                  return appendErrorLog({
                                    identifier: law.identificador,
                                    tag: error._tag,
                                    message: error.message,
                                  }).pipe(Effect.as(null));
                                },
                                SourceConnectionError: (error) => {
                                  if (shouldFailFastOnSourceError(mode)) {
                                    return Effect.fail(error);
                                  }

                                  return appendErrorLog({
                                    identifier: law.identificador,
                                    tag: error._tag,
                                    message: error.message,
                                  }).pipe(Effect.as(null));
                                },
                                CollectionError: (error) => {
                                  if (shouldFailFastOnSourceError(mode)) {
                                    return Effect.fail(error);
                                  }

                                  return appendErrorLog({
                                    identifier: law.identificador,
                                    tag: error._tag,
                                    message: error.message,
                                  }).pipe(Effect.as(null));
                                },
                              }),
                            );

                            if (prepared === null) {
                              return {
                                prepared: null as PreparedLaw | null,
                                inserted: 0,
                                updated: 0,
                                failed: 1,
                                document: null as CollectedDocument | null,
                              };
                            }

                            const document = yield* Effect.try({
                              try: () =>
                                buildDocument(
                                  law,
                                  prepared.kind,
                                  prepared.mapped.document.rawMetadata,
                                  prepared.contentText,
                                  prepared.contentHash,
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

                                return appendErrorLog({
                                  identifier: law.identificador,
                                  tag: error._tag,
                                  message: error.message,
                                }).pipe(Effect.as(null));
                              }),
                            );

                            return {
                              prepared,
                              inserted: prepared.kind === "New" ? 1 : 0,
                              updated: prepared.kind === "Update" ? 1 : 0,
                              failed: document === null ? 1 : 0,
                              document,
                            };
                          }),
                        { concurrency: config.perPageConcurrency },
                      );

                      const preparedLaws = outcomes
                        .map((outcome) => outcome.prepared)
                        .filter((prepared): prepared is PreparedLaw => prepared !== null);

                      yield* persistPreparedLaws(preparedLaws, runId);

                      const documents = outcomes
                        .map((outcome) => outcome.document)
                        .filter((document): document is CollectedDocument => document !== null);
                      const inserted = outcomes.reduce((acc, outcome) => acc + outcome.inserted, 0);
                      const updated = outcomes.reduce((acc, outcome) => acc + outcome.updated, 0);
                      const failed = outcomes.reduce((acc, outcome) => acc + outcome.failed, 0);

                      yield* Ref.update(statsRef, (stats) => ({
                        inserted: stats.inserted + inserted,
                        updated: stats.updated + updated,
                        failed: stats.failed + failed,
                      }));

                      const hasMore = page.length === config.batchSize;
                      const nextOffset = state.offset + config.batchSize;

                      const requestDelayMs = Duration.toMillis(requestDelay);
                      const effectiveDelayMs = isFullSyncLike(mode)
                        ? Math.max(50, Math.floor(requestDelayMs / 4))
                        : requestDelayMs;

                      if (hasMore && effectiveDelayMs > 0) {
                        yield* Effect.sleep(Duration.millis(effectiveDelayMs));
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

      return collectorRuntime;
    }),
});
