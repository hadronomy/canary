import { Effect, Schema } from "effect";

import { db, eq } from "@canary/db";
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
    Effect.tryPromise({
      try: async () => {
        const resolved = { ...defaults, ...input };
        const existing = await db
          .select({ sourceId: legislativeSources.sourceId })
          .from(legislativeSources)
          .where(eq(legislativeSources.sourceCode, resolved.sourceCode))
          .limit(1);

        if (existing[0] !== undefined) {
          return existing[0].sourceId;
        }

        const inserted = await db
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
          .returning({ sourceId: legislativeSources.sourceId });

        return inserted[0]!.sourceId;
      },
      catch: (cause) =>
        new BoeBootstrapError({
          operation: "ensureBoeSource",
          message: `Failed to ensure BOE legislative source: ${String(cause)}`,
          cause,
        }),
    }),
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
          since: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
          lookBackWindow: undefined,
        }),
        config: {
          sourceId,
          baseUrl: "https://boe.es/datosabiertos/api/legislacion-consolidada",
          batchSize: 250,
          timeoutMs: 30000,
          requestDelayMs: 50,
          perPageConcurrency: 16,
          ingestTextVersions: true,
          textFetchMaxAttempts: 3,
          textRetryBaseMs: 250,
          textRequestTimeoutMs: 45000,
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
    Effect.tryPromise({
      try: async () => {
        const docs = await db
          .select({ docId: legalDocuments.docId })
          .from(legalDocuments)
          .where(eq(legalDocuments.sourceId, sourceId));
        return docs.length;
      },
      catch: (cause) =>
        new BoeBootstrapError({
          operation: "countDocumentsForSource",
          message: `Failed to count source docs: ${String(cause)}`,
          cause,
        }),
    }),
);
