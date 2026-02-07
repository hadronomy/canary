import { describe, expect, test } from "bun:test";

import { Duration, Effect, Either, Layer, Metric, Option, Schema, Stream } from "effect";

import type { Collector } from "./collector";
import { defineFactory } from "./factory";
import {
  CollectionBatch,
  CollectionMode,
  collectorDocumentsProcessedTotal,
  collectorRunsCompletedTotal,
  CollectedDocument,
  CollectionRunId,
  CollectorFactoryRegistry,
  CollectorOrchestrator,
  CollectorRepository,
  CollectorStateManager,
  FactoryId,
  type CollectorId,
} from "./index";

const decodeDateTimeUtc = Schema.decodeSync(Schema.DateTimeUtc);

const TestFactory = defineFactory({
  id: "test-orchestrator",
  name: "Test Orchestrator Factory",
  description: "Factory used by orchestrator tests",
  configSchema: Schema.Struct({
    delayMs: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), { default: () => 0 }),
  }),
  capabilities: new Set(["FullSync", "Incremental", "Backfill", "Resume"]),
  make: ({ collectorId, name, config }) => {
    const collector: Collector = {
      id: collectorId,
      factoryId: FactoryId("test-orchestrator"),
      name,
      capabilities: new Set(["FullSync", "Incremental", "Backfill", "Resume"]),
      collect: (_mode, _runId) =>
        Stream.fromEffect(
          Effect.sleep(Duration.millis(config.delayMs)).pipe(
            Effect.zipRight(
              Effect.succeed(
                new CollectionBatch({
                  documents: [
                    new CollectedDocument({
                      externalId: "doc-1",
                      title: "Test",
                      content: "payload",
                      metadata: {},
                      publishedAt: decodeDateTimeUtc(new Date().toISOString()),
                      updatedAt: Option.none(),
                      sourceUrl: Option.none(),
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
        ),
      validate: Effect.void,
      detectChanges: () => Effect.succeed(false),
      estimateTotal: () => Effect.succeed(Option.none()),
      healthCheck: Effect.succeed({ status: "healthy", checkedAt: new Date() } as const),
    };

    return Effect.succeed(collector);
  },
});

const TestLayer = Layer.mergeAll(
  CollectorFactoryRegistry.Default,
  CollectorRepository.Default,
  CollectorStateManager.Default,
  CollectorOrchestrator.Default,
);

const createCollector = (name: string, delayMs = 0) =>
  Effect.gen(function* () {
    const registry = yield* CollectorFactoryRegistry;
    yield* registry.register(TestFactory);

    const entry = yield* CollectorRepository.create({
      factoryId: TestFactory.id,
      name,
      description: "test",
      enabled: true,
      schedule: "*/1 * * * *",
      defaultMode: CollectionMode.FullSync({ startDate: undefined, batchSize: undefined }),
      config: { delayMs },
    });

    return entry.collectorId;
  });

const waitForRunCompletion = (runId: CollectionRunId) =>
  Effect.gen(function* () {
    let attempts = 0;
    while (attempts < 100) {
      const snapshot = yield* CollectorStateManager.getRunSnapshot(runId);
      if (Option.isNone(snapshot)) return;
      yield* Effect.sleep(Duration.millis(10));
      attempts += 1;
    }
    throw new Error(`Run '${runId}' did not complete in time`);
  });

const waitForRunStart = (runId: CollectionRunId) =>
  Effect.gen(function* () {
    let attempts = 0;
    while (attempts < 100) {
      const running = yield* CollectorOrchestrator.running;
      if (running.some((item) => item.runId === runId)) return;
      yield* Effect.sleep(Duration.millis(10));
      attempts += 1;
    }
    throw new Error(`Run '${runId}' did not start in time`);
  });

describe("CollectorOrchestrator", () => {
  test("schedule returns runId and completes queued run", async () => {
    const program = Effect.gen(function* () {
      const collectorId = yield* createCollector("schedule-test");
      const runId = yield* CollectorOrchestrator.schedule(collectorId);
      yield* waitForRunCompletion(runId);
      const status = yield* CollectorOrchestrator.status;
      return { runId, status };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.runId).toBeDefined();
    expect(result.status.running).toBe(0);
  });

  test("scheduleExplicit executes provided mode", async () => {
    const program = Effect.gen(function* () {
      const collectorId = yield* createCollector("schedule-explicit-test");
      const runId = yield* CollectorOrchestrator.scheduleExplicit(
        collectorId,
        CollectionMode.Backfill({
          from: new Date("2025-01-01"),
          to: new Date("2025-01-31"),
          batchSize: undefined,
        }),
      );
      yield* waitForRunCompletion(runId);
      return runId;
    });

    const runId = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(runId).toBeDefined();
  });

  test("collectNow returns immediate stats", async () => {
    const program = Effect.gen(function* () {
      const collectorId = yield* createCollector("collect-now-test");
      const completedMetric = collectorRunsCompletedTotal.pipe(
        Metric.tagged("collector_id", collectorId),
        Metric.tagged("mode", "FullSync"),
      );
      const processedMetric = collectorDocumentsProcessedTotal.pipe(
        Metric.tagged("collector_id", collectorId),
        Metric.tagged("mode", "FullSync"),
      );

      const beforeCompleted = yield* Metric.value(completedMetric);
      const beforeProcessed = yield* Metric.value(processedMetric);
      const stats = yield* CollectorOrchestrator.collectNow(
        collectorId,
        CollectionMode.FullSync({ startDate: undefined, batchSize: undefined }),
      );
      const afterCompleted = yield* Metric.value(completedMetric);
      const afterProcessed = yield* Metric.value(processedMetric);
      return { stats, beforeCompleted, beforeProcessed, afterCompleted, afterProcessed };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(result.stats.processed).toBe(1);
    expect(result.stats.inserted).toBe(1);
    expect(result.afterCompleted.count - result.beforeCompleted.count).toBe(1);
    expect(result.afterProcessed.count - result.beforeProcessed.count).toBe(1);
  });

  test("resume fails with ResumeError when run snapshot is missing", async () => {
    const program = Effect.gen(function* () {
      const collectorId = yield* createCollector("resume-missing-test");
      return yield* Effect.either(
        CollectorOrchestrator.resume(collectorId, CollectionRunId("missing-run")),
      );
    });

    const either = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left._tag).toBe("ResumeError");
    }
  });

  test("cancel interrupts an active scheduled run", async () => {
    const program = Effect.gen(function* () {
      const collectorId: CollectorId = yield* createCollector("cancel-test", 200);
      const runId = yield* CollectorOrchestrator.schedule(collectorId);
      yield* waitForRunStart(runId);
      yield* CollectorOrchestrator.cancel(runId, "cancelled by test");
      yield* Effect.sleep(Duration.millis(25));
      const snapshot = yield* CollectorStateManager.getRunSnapshot(runId);
      return snapshot;
    });

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(Option.isNone(snapshot)).toBe(true);
  });

  test("collectAll enqueues all enabled collectors", async () => {
    const program = Effect.gen(function* () {
      yield* createCollector("collect-all-a");
      yield* createCollector("collect-all-b");
      const runIds = yield* CollectorOrchestrator.collectAll;
      yield* Effect.forEach(runIds, waitForRunCompletion, { discard: true });
      const status = yield* CollectorOrchestrator.status;
      return { runIds, status };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    expect(Array.isArray(result.runIds)).toBe(true);
    expect(result.status.running).toBe(0);
  });
});
