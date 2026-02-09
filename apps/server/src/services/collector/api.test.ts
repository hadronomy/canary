import { describe, expect, test } from "bun:test";

import { Duration, Effect, Option, Schema, Stream } from "effect";

import {
  collector,
  CollectorFactoryRegistry,
  CollectorLiveWithFactories,
  CollectionBatch,
  CollectedDocument,
  CollectionMode,
  defineFactory,
} from "./index";

const decodeDateTimeUtc = Schema.decodeSync(Schema.DateTimeUtc);

const FacadeFactory = defineFactory({
  id: "facade-test-rss",
  name: "Facade Test RSS",
  description: "Factory for collector facade tests",
  configSchema: Schema.Struct({
    feedUrl: Schema.String,
    delayMs: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), { default: () => 0 }),
  }),
  capabilities: new Set(["FullSync", "Incremental", "Resume"]),
  make: ({ config }) =>
    Effect.succeed({
      collect: (_mode, _runId) =>
        Stream.fromEffect(
          Effect.sleep(Duration.millis(config.delayMs)).pipe(
            Effect.as(
              new CollectionBatch({
                documents: [
                  new CollectedDocument({
                    externalId: "facade-doc-1",
                    title: "Facade Document",
                    content: "payload",
                    metadata: {},
                    publishedAt: decodeDateTimeUtc(new Date().toISOString()),
                    updatedAt: Option.none(),
                    sourceUrl: Option.some(config.feedUrl),
                    contentHash: Option.none(),
                    kind: "New",
                  }),
                ],
                cursor: Option.none(),
                hasMore: false,
              }),
            ),
          ),
        ),
      validate: Effect.void,
      detectChanges: () => Effect.succeed(false),
      estimateTotal: () => Effect.succeed(Option.none()),
      healthCheck: Effect.succeed({ status: "healthy", checkedAt: new Date() } as const),
    }),
});

describe("collector facade", () => {
  test("register/create/run/status flow works end-to-end", async () => {
    const program = Effect.gen(function* () {
      const sourceId = yield* collector.create({
        factory: FacadeFactory,
        name: "Facade Source",
        schedule: "*/5 * * * *",
        mode: CollectionMode.Incremental({ since: new Date(), lookBackWindow: undefined }),
        config: {
          feedUrl: "https://example.com/feed.xml",
          delayMs: 10,
        },
      });

      const runId = yield* collector.runOnce(sourceId);
      yield* Effect.sleep(Duration.millis(30));

      const status = yield* collector.status();
      const source = yield* collector.source(sourceId);

      return { runId, status, source };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(CollectorLiveWithFactories(FacadeFactory))),
    );
    expect(result.runId).toBeDefined();
    expect(result.status.running).toBe(0);
    expect(result.source.name).toBe("Facade Source");
  });

  test("registerFactory remains available for dynamic registration", async () => {
    const program = Effect.gen(function* () {
      yield* collector.registerFactory(FacadeFactory);
      const factories = yield* collector.factories();
      return factories.some((factory) => factory.id === FacadeFactory.id);
    });

    const hasFactory = await Effect.runPromise(
      program.pipe(Effect.provide(CollectorFactoryRegistry.Default)),
    );
    expect(hasFactory).toBe(true);
  });
});
