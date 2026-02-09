import { Effect, Layer, Schema } from "effect";

import { ValidationError } from "./errors";
import { CollectorFactoryRegistry, type CollectorFactory, type ConfigType } from "./factory";
import { CollectorOrchestrator } from "./orchestrator";
import { CollectorRepository, CollectorFilter } from "./repository";
import { CollectorScheduler, type ScheduleStartOptions } from "./scheduler";
import { CollectorId as CollectorIdBrand, FactoryId } from "./schema";
import type { CollectionMode, CollectionRunId, CollectorId } from "./schema";
import { CollectorStateManager } from "./state";

type AnySchema = Schema.Schema.AnyNoContext;
type AnyFactory = CollectorFactory<AnySchema, unknown>;
type FactorySchema<F extends AnyFactory> = F extends CollectorFactory<infer S, unknown> ? S : never;

export interface CollectorCreateInput<F extends AnyFactory> {
  readonly factory: F;
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly schedule: string;
  readonly mode: CollectionMode;
  readonly config: ConfigType<FactorySchema<F>>;
}

export interface CollectorUpdateInput {
  readonly id: CollectorId;
  readonly name?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly schedule?: string;
  readonly mode?: CollectionMode;
  readonly config?: unknown;
}

const toSummary = (entry: {
  readonly collectorId: CollectorId;
  readonly name: string;
  readonly enabled: boolean;
  readonly schedule: string;
  readonly defaultMode: CollectionMode;
  readonly factoryId: string;
}) => ({
  id: entry.collectorId,
  name: entry.name,
  enabled: entry.enabled,
  schedule: entry.schedule,
  mode: entry.defaultMode,
  factoryId: entry.factoryId,
});

export const collector = {
  /**
   * @deprecated Prefer static factory wiring with CollectorLiveWithFactories(...factories).
   * Dynamic registration remains for compatibility and tests.
   */
  registerFactory: <S extends AnySchema, R>(factory: CollectorFactory<S, R>) =>
    Effect.gen(function* () {
      const registry = yield* CollectorFactoryRegistry;
      yield* registry.register(factory);
    }),

  factory: (id: string) =>
    Effect.gen(function* () {
      const registry = yield* CollectorFactoryRegistry;
      return yield* registry.get(FactoryId(id));
    }),

  factories: () =>
    Effect.gen(function* () {
      const registry = yield* CollectorFactoryRegistry;
      return yield* registry.list;
    }),

  create: <F extends AnyFactory>(input: CollectorCreateInput<F>) =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const decodedConfig = yield* Schema.decodeUnknown(input.factory.configSchema)(
        input.config,
      ).pipe(
        Effect.mapError(
          (parseError) =>
            new ValidationError({
              collectorId: CollectorIdBrand("00000000-0000-0000-0000-000000000000"),
              field: "config",
              value: input.config,
              reason: String(parseError),
              message: "Collector config did not match factory schema",
            }),
        ),
      );

      const created = yield* repository.create({
        factoryId: input.factory.id,
        name: input.name,
        description: input.description,
        enabled: input.enabled ?? true,
        schedule: input.schedule,
        defaultMode: input.mode,
        config: decodedConfig,
      });

      return created.collectorId;
    }),

  update: (input: CollectorUpdateInput) =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const registry = yield* CollectorFactoryRegistry;
      const entry = yield* repository.findOne(input.id);

      const decodedConfig =
        input.config === undefined
          ? undefined
          : yield* registry.validateConfig(FactoryId(entry.factoryId), input.id, input.config).pipe(
              Effect.catchTag(
                "ConfigValidationError",
                (parseError) =>
                  new ValidationError({
                    collectorId: input.id,
                    field: "config",
                    value: input.config,
                    reason: parseError.issues.join("; "),
                    message: "Collector config did not match factory schema",
                  }),
              ),
            );

      yield* repository.update(input.id, {
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        schedule: input.schedule,
        defaultMode: input.mode,
        config: decodedConfig,
      });
    }),

  remove: (sourceId: CollectorId) =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      yield* repository.remove(sourceId);
    }),

  source: (sourceId: CollectorId) =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const entry = yield* repository.findOne(sourceId);
      return toSummary(entry);
    }),

  sources: () =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const entries = yield* repository.findMany(CollectorFilter.all());
      return entries.map(toSummary);
    }),

  enabledSources: () =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const entries = yield* repository.findMany(CollectorFilter.enabled());
      return entries.map(toSummary);
    }),

  runOnce: (sourceId: CollectorId) => CollectorOrchestrator.schedule(sourceId),

  runWithMode: (sourceId: CollectorId, mode: CollectionMode) =>
    CollectorOrchestrator.scheduleExplicit(sourceId, mode),

  runNow: (sourceId: CollectorId, mode?: CollectionMode) =>
    Effect.gen(function* () {
      const repository = yield* CollectorRepository;
      const entry = yield* repository.findOne(sourceId);
      return yield* CollectorOrchestrator.collectNow(sourceId, mode ?? entry.defaultMode);
    }),

  runAll: () => CollectorOrchestrator.collectAll,

  resumeRun: (sourceId: CollectorId, runId: CollectionRunId) =>
    CollectorOrchestrator.resume(sourceId, runId),

  cancelRun: (runId: CollectionRunId, reason?: string) =>
    CollectorOrchestrator.cancel(runId, reason),

  status: () => CollectorOrchestrator.status,

  running: () => CollectorOrchestrator.running,

  runSnapshot: (runId: CollectionRunId) => CollectorStateManager.getRunSnapshot(runId),

  schedule: (sourceId: CollectorId, cron?: string, options?: ScheduleStartOptions) =>
    Effect.gen(function* () {
      if (cron !== undefined) {
        return yield* CollectorScheduler.start(sourceId, cron, options);
      }

      const repository = yield* CollectorRepository;
      const entry = yield* repository.findOne(sourceId);
      return yield* CollectorScheduler.start(sourceId, entry.schedule, options);
    }),

  stopSchedule: (sourceId: CollectorId) => CollectorScheduler.stop(sourceId),

  reschedule: (sourceId: CollectorId, cron: string, options?: ScheduleStartOptions) =>
    CollectorScheduler.reschedule(sourceId, cron, options),

  startAllSchedules: () => CollectorScheduler.startAll,

  stopAllSchedules: () => CollectorScheduler.stopAll,

  triggerNow: (sourceId: CollectorId) => CollectorScheduler.triggerNow(sourceId),

  schedules: () => CollectorScheduler.scheduled,
};

const CollectorRuntimeLive = Layer.mergeAll(
  CollectorRepository.Default,
  CollectorStateManager.Default,
  CollectorOrchestrator.Default,
  CollectorScheduler.Default,
).pipe(Layer.provide(CollectorFactoryRegistry.Default));

/**
 * @deprecated Prefer CollectorLiveWithFactories(...factories) for deterministic wiring and dependency inference.
 */
export const CollectorLive = Layer.mergeAll(CollectorFactoryRegistry.Default, CollectorRuntimeLive);

export const CollectorLiveWithFactories = <const Factories extends ReadonlyArray<AnyFactory>>(
  ...factories: Factories
) => {
  const registry = CollectorFactoryRegistry.layer(...factories);
  const runtime = Layer.mergeAll(
    CollectorRepository.Default,
    CollectorStateManager.Default,
    CollectorOrchestrator.Default,
    CollectorScheduler.Default,
  ).pipe(Layer.provide(registry));

  return Layer.mergeAll(registry, runtime);
};
