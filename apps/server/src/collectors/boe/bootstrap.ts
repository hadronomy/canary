import { Duration, Effect, Schema } from "effect";

import { count, eq } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
import { legalDocuments, legislativeSources } from "@canary/db/schema/legislation";
import { collector } from "~/services/collector/api";
import { CollectionMode } from "~/services/collector/schema";

import { BoeLawsCollectorFactory } from "./factory";

export class BoeBootstrapError extends Schema.TaggedError<BoeBootstrapError>()(
  "BoeBootstrapError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface EnsureBoeCollectorInput {
  readonly sourceCode?: string;
  readonly sourceName?: string;
  readonly collectorName?: string;
  readonly collectorDescription?: string;
  readonly schedule?: string;
  readonly query?: string;
}

const defaults: Required<EnsureBoeCollectorInput> = {
  sourceCode: "BOE_CONSOLIDADA",
  sourceName: "Boletin Oficial del Estado - Legislacion Consolidada",
  collectorName: "BOE Consolidated Laws",
  collectorDescription: "Collects and syncs BOE consolidated legislation",
  schedule: "0 */4 * * *",
  query: "",
};

export const ensureBoeSource = Effect.fn("BoeCollector.ensureBoeSource")(
  (input?: EnsureBoeCollectorInput) =>
    Effect.gen(function* () {
      const resolved = { ...defaults, ...input };
      const db = yield* DatabaseService.client();
      const existingRows = yield* db
        .select({ sourceId: legislativeSources.sourceId })
        .from(legislativeSources)
        .where(eq(legislativeSources.sourceCode, resolved.sourceCode))
        .limit(1)
        .pipe(
          Effect.mapError(
            (cause) =>
              new BoeBootstrapError({
                operation: "ensureBoeSource.findLegislativeSource",
                message: `Failed to query legislative source: ${String(cause)}`,
                cause,
              }),
          ),
        );

      const existingSourceId = existingRows[0]?.sourceId;
      if (existingSourceId !== undefined) {
        return existingSourceId;
      }

      const inserted = yield* db
        .insert(legislativeSources)
        .values({
          sourceCode: resolved.sourceCode,
          sourceName: resolved.sourceName,
          shortName: "BOE",
          description: "Official BOE consolidated laws source",
          jurisdiction: "estatal",
          autonomousCommunity: null,
          isParliamentary: false,
          isOfficialGazette: true,
          providesStage: ["bulletin", "enacted", "repealed", "expired"],
          baseUrl: "https://boe.es/datosabiertos/api/legislacion-consolidada",
          apiConfig: {
            supportsIncremental: true,
            supportsBackfill: true,
            format: "json",
          },
        })
        .returning({ sourceId: legislativeSources.sourceId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new BoeBootstrapError({
                operation: "ensureBoeSource.insertLegislativeSource",
                message: `Failed to insert legislative source: ${String(cause)}`,
                cause,
              }),
          ),
        );

      return inserted[0]!.sourceId;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new BoeBootstrapError({
            operation: "ensureBoeSource",
            message: `Failed to ensure BOE legislative source: ${String(cause)}`,
            cause,
          }),
      ),
    ),
);

export const ensureBoeCollector = Effect.fn("BoeCollector.ensureBoeCollector")(
  (input?: EnsureBoeCollectorInput) =>
    Effect.gen(function* () {
      const resolved = { ...defaults, ...input };
      const sourceId = yield* ensureBoeSource(resolved);

      const existingCollectors = yield* collector.sources();
      const existing = existingCollectors.find(
        (entry) => entry.factoryId === BoeLawsCollectorFactory.id,
      );
      if (existing !== undefined) {
        return existing.id;
      }

      return yield* collector.create({
        factory: BoeLawsCollectorFactory,
        name: resolved.collectorName,
        description: resolved.collectorDescription,
        enabled: true,
        schedule: resolved.schedule,
        mode: CollectionMode.Incremental({
          since: new Date(Date.now() - Duration.toMillis(Duration.days(7))),
          lookBackWindow: undefined,
        }),
        config: {
          sourceId,
          baseUrl: "https://boe.es/datosabiertos/api/legislacion-consolidada",
          batchSize: 250,
          timeout: Duration.seconds(30),
          requestDelay: Duration.millis(50),
          perPageConcurrency: 4,
          ingestTextVersions: true,
          textFetchMaxAttempts: 3,
          textRetryBase: Duration.millis(250),
          textRequestTimeout: Duration.seconds(45),
          trackSyncRuns: true,
          unknownRangeStrategy: "regulation",
          upsertActor: "collector:boe-laws",
          staticQuery: resolved.query,
        },
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new BoeBootstrapError({
            operation: "ensureBoeCollector",
            message: `Failed to ensure BOE collector: ${String(cause)}`,
            cause,
          }),
      ),
    ),
);

export const countDocumentsForSource = Effect.fn("BoeCollector.countDocumentsForSource")(
  (sourceId: string) =>
    Effect.gen(function* () {
      const db = yield* DatabaseService.client();
      const docs = yield* db
        .select({ total: count() })
        .from(legalDocuments)
        .where(eq(legalDocuments.sourceId, sourceId))
        .pipe(
          Effect.mapError(
            (cause) =>
              new BoeBootstrapError({
                operation: "countDocumentsForSource.query",
                message: `Failed to count source docs: ${String(cause)}`,
                cause,
              }),
          ),
        );
      return Number(docs[0]?.total ?? 0);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new BoeBootstrapError({
            operation: "countDocumentsForSource",
            message: `Failed to count source docs: ${String(cause)}`,
            cause,
          }),
      ),
    ),
);
