import { Duration, Effect, Metric, Option, Schema, Stream } from "effect";
import { XMLParser } from "fast-xml-parser";

import type { Collector } from "~/services/collector/collector";
import { CollectionError, SourceConnectionError } from "~/services/collector/errors";
import { defineFactory, type ConfigType } from "~/services/collector/factory";
import {
  rssFetchDurationMs,
  rssFetchErrorsTotal,
  rssItemsParsedTotal,
  rssParseDurationMs,
} from "~/services/collector/metrics";
import {
  CollectedDocument,
  CollectionBatch,
  CollectionMode,
  type Capabilities,
  FactoryId,
} from "~/services/collector/schema";

import { RssCollectorConfig } from "./config";

type RssCollectorRuntimeConfig = ConfigType<typeof RssCollectorConfig>;

interface RssItem {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly link: string;
  readonly pubDate: Date;
  readonly category?: string;
}

const capabilities: Capabilities = new Set([
  "FullSync",
  "Incremental",
  "Backfill",
  "Resume",
  "ChangeDetection",
]);

const decodeDateTimeUtc = Schema.decodeSync(Schema.DateTimeUtc);

const parseItems = (xml: string, selectors: RssCollectorRuntimeConfig["selectors"]) =>
  Effect.sync(() => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name) => name === selectors.item,
    });
    const payload = parser.parse(xml) as {
      rss?: { channel?: { item?: Array<Record<string, string>> | Record<string, string> } };
    };
    const raw = payload.rss?.channel?.item;
    const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return source
      .map((item): RssItem | undefined => {
        const guid = item.guid ?? item.link;
        const title = item[selectors.title];
        const link = item[selectors.link];
        if (!guid || !title || !link) {
          return undefined;
        }
        const published = item[selectors.date];
        return {
          id: guid,
          title,
          content: item[selectors.content] ?? "",
          link,
          pubDate: published !== undefined ? new Date(published) : new Date(),
          category: item.category,
        };
      })
      .filter((item): item is RssItem => item !== undefined);
  });

const toDocument = (item: RssItem) =>
  new CollectedDocument({
    externalId: item.id,
    title: item.title,
    content: item.content,
    metadata: item.category ? { category: item.category } : {},
    publishedAt: decodeDateTimeUtc(item.pubDate.toISOString()),
    updatedAt: Option.none(),
    sourceUrl: Option.some(item.link),
    contentHash: Option.none(),
    kind: "New",
  });

const filterByMode = (
  items: ReadonlyArray<RssItem>,
  mode: CollectionMode,
  categories: ReadonlyArray<string>,
) => {
  const categoryFiltered =
    categories.length === 0
      ? items
      : items.filter((item) => item.category !== undefined && categories.includes(item.category));
  switch (mode._tag) {
    case "Incremental":
      return categoryFiltered.filter((item) => item.pubDate > mode.since);
    case "Backfill":
      return categoryFiltered.filter(
        (item) => item.pubDate >= mode.from && item.pubDate <= mode.to,
      );
    case "Resume":
      return filterByMode(categoryFiltered, mode.originalMode, categories);
    default:
      return categoryFiltered;
  }
};

export const RssCollectorFactory = defineFactory({
  id: "rss-feed",
  name: "RSS Feed Collector",
  description: "Collects documents from RSS feeds",
  configSchema: RssCollectorConfig,
  capabilities,
  make: ({ collectorId, name, config }) => {
    const selectors = config.selectors;

    const withCollectorTag = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.tagMetrics({ collector_id: collectorId }));

    const fetchFeed = Effect.fn("RssCollector.fetchFeed")(
      () =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(config.feedUrl);
            if (!response.ok) {
              throw new SourceConnectionError({
                collectorId,
                sourceUrl: config.feedUrl,
                cause: `HTTP ${response.status}`,
                message: `Cannot reach source '${config.feedUrl}' for collector '${collectorId}'`,
              });
            }
            return response.text();
          },
          catch: (cause) =>
            cause instanceof SourceConnectionError
              ? cause
              : new SourceConnectionError({
                  collectorId,
                  sourceUrl: config.feedUrl,
                  cause,
                  message: `Cannot reach source '${config.feedUrl}' for collector '${collectorId}'`,
                }),
        }),
      Metric.trackDurationWith(rssFetchDurationMs, (duration) => Duration.toMillis(duration)),
      Effect.tapError(() => withCollectorTag(Metric.increment(rssFetchErrorsTotal))),
      withCollectorTag,
    );

    const collect = Effect.fn("RssCollector.collect")((mode: CollectionMode) =>
      fetchFeed().pipe(
        Effect.flatMap((xml) =>
          parseItems(xml, selectors).pipe(
            Metric.trackDurationWith(rssParseDurationMs, (duration) => Duration.toMillis(duration)),
            Effect.tap((items) =>
              withCollectorTag(Metric.incrementBy(rssItemsParsedTotal, items.length)),
            ),
            withCollectorTag,
          ),
        ),
        Effect.map((items) => filterByMode(items, mode, config.filterByCategory)),
        Effect.map(
          (items) =>
            new CollectionBatch({
              documents: items.map(toDocument),
              cursor: Option.none(),
              hasMore: false,
            }),
        ),
        Effect.mapError(
          (error) =>
            new CollectionError({
              collectorId,
              runId: undefined,
              reason: "RSS collection failed",
              cause: error,
              message: `Collection error [${collectorId}]: RSS collection failed`,
            }),
        ),
      ),
    );

    const collector: Collector = {
      id: collectorId,
      factoryId: FactoryId("rss-feed"),
      name,
      capabilities,
      collect: (mode) => Stream.fromEffect(collect(mode)),
      validate: fetchFeed().pipe(Effect.asVoid),
      detectChanges: (since) =>
        fetchFeed().pipe(
          Effect.flatMap((xml) =>
            parseItems(xml, selectors).pipe(
              Metric.trackDurationWith(rssParseDurationMs, (duration) =>
                Duration.toMillis(duration),
              ),
              withCollectorTag,
            ),
          ),
          Effect.map((items) => items.some((item) => item.pubDate > since)),
        ),
      estimateTotal: () => Effect.succeed(Option.none()),
      healthCheck: fetchFeed().pipe(
        Effect.map(() => ({ status: "healthy" as const, checkedAt: new Date() })),
        Effect.catchTag("SourceConnectionError", (error) =>
          Effect.succeed({
            status: "unhealthy" as const,
            message: error.message,
            checkedAt: new Date(),
          }),
        ),
      ),
    };

    return Effect.succeed(collector);
  },
});
