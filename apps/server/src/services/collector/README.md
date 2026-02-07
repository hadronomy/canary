# Collector API

Collector is the server-side ingestion runtime that replaces the previous feed collector flow.
It is built with Effect services, strongly typed schemas, tagged errors, queue orchestration, and cron scheduling.

## Module Map

- `schema.ts` - domain types + runtime schemas
- `errors.ts` - tagged, serializable domain errors
- `collector.ts` - collector interface contract
- `factory.ts` - factory definition + registry with schema-inferred config typing
- `repository.ts` - collector entry persistence abstraction
- `state.ts` - run/state management abstraction
- `orchestrator.ts` - runId-first queue-driven execution engine
- `scheduler.ts` - cron scheduler over orchestrator
- `api.ts` - ergonomic facade (`collector`) + consolidated layer (`CollectorLive`)
- `index.ts` - barrel export
- `../collectors/rss/config.ts` - RSS config schema
- `../collectors/rss/factory.ts` - RSS collector factory

## Architecture Overview

1. A `CollectorFactory` is registered in `CollectorFactoryRegistry`.
2. `CollectorRepository` provides `CollectorEntry` rows (factory id, config, schedule, mode).
3. `CollectorOrchestrator` resolves entries into concrete `Collector` instances and runs runId-first jobs.
4. `CollectorScheduler` validates cron expressions with Effect `Cron.parse` and triggers orchestrator jobs on schedule.
5. `CollectorStateManager` tracks run lifecycle/progress/state.

## Type Safety Model

The config type is inferred directly from each factory schema.

- `CollectorFactory<S>` uses `configSchema: S`
- `ConfigType<S> = Schema.Schema.Type<S>`
- `make({ config })` receives `ConfigType<S>` exactly
- registry decode path uses the same schema before instantiation

This guarantees the decoded runtime config and compile-time config type always match.

---

## Quick Start

```ts
import { Effect, Layer } from "effect";
import {
  CollectorFactoryRegistry,
  CollectorRepository,
  CollectorStateManager,
  CollectorOrchestrator,
  CollectorScheduler,
} from "~/services/collector";
import { RssCollectorFactory } from "~/collectors/rss/factory";

const CollectorLive = Layer.mergeAll(
  CollectorFactoryRegistry.Default,
  CollectorRepository.Default,
  CollectorStateManager.Default,
  CollectorOrchestrator.Default,
  CollectorScheduler.Default,
);

const program = Effect.gen(function* () {
  const registry = yield* CollectorFactoryRegistry;
  yield* registry.register(RssCollectorFactory);
  yield* CollectorScheduler.startAll;
});

// Effect.runPromise(program.pipe(Effect.provide(CollectorLive)))
```

Facade-first quick start:

```ts
import { Effect } from "effect";
import { collector, CollectorLive, CollectionMode } from "~/services/collector";
import { RssCollectorFactory } from "~/collectors/rss/factory";

const app = Effect.gen(function* () {
  yield* collector.registerFactory(RssCollectorFactory);

  const sourceId = yield* collector.create({
    factory: RssCollectorFactory,
    name: "BOC RSS",
    schedule: "*/15 * * * *",
    mode: CollectionMode.Incremental({
      since: new Date(Date.now() - 3600_000),
      lookBackWindow: undefined,
    }),
    config: { feedUrl: "https://example.com/feed.xml" },
  });

  const runId = yield* collector.runOnce(sourceId);
  return yield* collector.runSnapshot(runId);
});

// Effect.runPromise(app.pipe(Effect.provide(CollectorLive)))
```

---

## `schema.ts`

Purpose: shared domain model used by all collector services.

Important exports:

- IDs: `CollectorId`, `FactoryId`, `CollectionRunId`
- capability model: `Capability`, `Capabilities`, `hasCapability`, `assertCapability`
- modes: `CollectionMode`, `CollectionModeSchema`
- run lifecycle: `CollectionRunStatus`, `CollectionRunStatusSchema`, `CollectionRun`, `CollectionProgress`, `CollectionStats`
- state and records: `CollectionState`, `CollectorEntry`
- payloads: `CollectedDocument`, `CollectionBatch`, `CollectionCursor`

Example:

```ts
import { CollectionMode } from "~/services/collector";

const mode = CollectionMode.Incremental({
  since: new Date(Date.now() - 3600_000),
  lookBackWindow: undefined,
});
```

---

## `errors.ts`

Purpose: explicit typed failures for all collector domains.

All errors are `Schema.TaggedError` and include a `message` field for safe serialization.

Main errors:

- `CollectorNotFoundError`
- `FactoryNotFoundError`
- `ConfigValidationError`
- `CollectionError`
- `SourceConnectionError`
- `ScheduleError`
- `ModeNotSupportedError`
- `ResumeError`
- `ValidationError`
- `HealthCheckError`

Example:

```ts
import { Effect, ScheduleError } from "~/services/collector";

const invalidCron = (collectorId: string, expression: string) =>
  Effect.fail(
    new ScheduleError({
      collectorId,
      schedule: expression,
      reason: "Invalid cron expression",
      message: `Invalid cron expression '${expression}' for collector '${collectorId}'`,
    }),
  );
```

---

## `collector.ts`

Purpose: runtime contract implemented by each concrete collector.

API:

- `collect(mode, runId): Stream<CollectionBatch, CollectorError>`
- `validate: Effect<void, CollectorError>`
- `detectChanges(since): Effect<boolean, CollectorError>`
- `estimateTotal(mode): Effect<Option<number>, CollectorError>`
- `healthCheck: Effect<HealthStatus, never>`

Example shape:

```ts
import type { Collector } from "~/services/collector";

const collector: Collector = {
  id,
  factoryId,
  name: "Example",
  capabilities: new Set(["FullSync", "Incremental"]),
  collect: (mode, runId) => stream,
  validate: validateEffect,
  detectChanges: (since) => detectEffect,
  estimateTotal: (mode) => estimateEffect,
  healthCheck: healthEffect,
};
```

---

## `factory.ts`

Purpose: define, register, discover, and instantiate collectors.

### Factory typing

```ts
type ConfigType<S extends Schema.Schema.AnyNoContext> = Schema.Schema.Type<S>;
```

`defineFactory` infers `S` from `configSchema`, so `make` receives a fully inferred and validated config type.

### Public pieces

- `CollectorFactory<S>`
- `defineFactory(...)`
- `CollectorFactoryRegistry` service
  - `register(factory)`
  - `get(factoryId)`
  - `list`
  - `instantiate(entry)`

Registry note: `CollectorFactoryRegistry` is configured with `accessors: false` because `register` is generic. Use service instance methods.

```ts
import { Effect, CollectorFactoryRegistry } from "~/services/collector";
import { RssCollectorFactory } from "~/collectors/rss/factory";

const program = Effect.gen(function* () {
  const registry = yield* CollectorFactoryRegistry;
  yield* registry.register(RssCollectorFactory);
  return yield* registry.list;
});
```

---

## `repository.ts`

Purpose: persistence boundary for `CollectorEntry`.

API:

- `findOne(id)`
- `findMany(filter)`
- `create(entry)`
- `update(id, patch)`
- `remove(id)`

Filters:

- `CollectorFilter.byId(id)`
- `CollectorFilter.byFactory(factoryId)`
- `CollectorFilter.enabled()`
- `CollectorFilter.all()`

```ts
import { Effect, CollectorFilter, CollectorRepository } from "~/services/collector";

const enabled = Effect.gen(function* () {
  return yield* CollectorRepository.findMany(CollectorFilter.enabled());
});
```

Current live implementation is in-memory.

---

## `state.ts`

Purpose: run lifecycle and collector state tracking.

API:

- `createRun`, `updateProgress`, `completeRun`, `failRun`, `cancelRun`
- `getResumableRun`, `getRunSnapshot`, `getActiveRuns`
- `getState`, `updateState`

```ts
import { Effect, CollectionMode, CollectorStateManager } from "~/services/collector";

const createRun = Effect.gen(function* () {
  return yield* CollectorStateManager.createRun(
    collectorId,
    CollectionMode.FullSync({ startDate: undefined, batchSize: undefined }),
  );
});
```

Current live implementation is in-memory.

---

## `orchestrator.ts`

Purpose: execute collection jobs using a bounded queue and worker fibers.

Runtime behavior:

- queue jobs are runId-first (`{ _tag: "Run", runId, collectorId, mode }`)
- enqueue path has explicit backpressure timeout protection
- each stream batch updates run progress through `CollectorStateManager.updateProgress`
- completion and failure paths update state manager lifecycle consistently
- worker boundary logs the full tagged collector error taxonomy via `catchTags`

Job variant:

- `Run`

Public API:

- `schedule(collectorId): Effect<CollectionRunId, CollectorError>`
- `scheduleExplicit(collectorId, mode): Effect<CollectionRunId, CollectorError>`
- `collectNow(collectorId, mode)`
- `resume(collectorId, runId)`
- `collectAll: Effect<ReadonlyArray<CollectionRunId>, CollectorError>`
- `cancel(runId, reason?)`
- `status`
- `running`

```ts
import { Effect, CollectionMode, CollectorOrchestrator } from "~/services/collector";

const runNow = Effect.gen(function* () {
  const queuedRunId = yield* CollectorOrchestrator.schedule(collectorId);

  return yield* CollectorOrchestrator.collectNow(
    collectorId,
    CollectionMode.Backfill({
      from: new Date("2025-01-01"),
      to: new Date("2025-01-31"),
      batchSize: undefined,
    }),
  );
});
```

---

## `scheduler.ts`

Purpose: recurring scheduling over orchestrator using Effect cron primitives.

Flow:

1. Parse with `Cron.parse`
2. Map parse failure to `ScheduleError`
3. Execute with `Effect.repeat(Schedule.cron(cron))`
4. Catch scheduled run errors and log without crashing scheduler fibers
5. Track running schedule fibers by collector id

Public API:

- `start(collectorId, cronExpression)`
- `stop(collectorId)`
- `startAll`
- `stopAll`
- `reschedule(collectorId, cronExpression)`
- `triggerNow(collectorId)`
- `scheduled`

```ts
import { Effect, CollectorScheduler } from "~/services/collector";

const scheduling = Effect.gen(function* () {
  yield* CollectorScheduler.start(collectorId, "*/15 * * * *");
  return yield* CollectorScheduler.scheduled;
});
```

---

## RSS Collector

### `../collectors/rss/config.ts`

`RssCollectorConfig` defines:

- `feedUrl`
- `selectors` with defaults
- `filterByCategory` default `[]`
- `pagination`
- `batchSize`, `timeoutMs`, `requestDelayMs` defaults

### `../collectors/rss/factory.ts`

`RssCollectorFactory` uses schema-inferred config typing:

```ts
type RssCollectorRuntimeConfig = ConfigType<typeof RssCollectorConfig>;
```

It supports:

- capabilities: `FullSync`, `Incremental`, `Backfill`, `Resume`, `ChangeDetection`
- source fetch + XML parse + mode filtering + batch emission
- typed error mapping to `SourceConnectionError` / `CollectionError`

Registration example:

```ts
import { Effect, CollectorFactoryRegistry } from "~/services/collector";
import { RssCollectorFactory } from "~/collectors/rss/factory";

const register = Effect.gen(function* () {
  const registry = yield* CollectorFactoryRegistry;
  yield* registry.register(RssCollectorFactory);
});
```

---

## How Components Work Together

This is the typical end-to-end flow in production:

1. Register one or more factories in `CollectorFactoryRegistry`.
2. Persist collector entries in `CollectorRepository` (factory id, schedule, mode, config).
3. Scheduler starts recurring runs (`CollectorScheduler.startAll`) using each entry schedule.
4. Scheduler triggers orchestrator jobs (`CollectorOrchestrator.schedule`).
5. Orchestrator resolves entry -> factory -> concrete collector and executes stream collection.
6. State manager tracks run lifecycle/progress/cancellation (`CollectorStateManager`).

### Integration Example

```ts
import { Effect, Layer } from "effect";
import {
  CollectorFactoryRegistry,
  CollectorRepository,
  CollectorStateManager,
  CollectorOrchestrator,
  CollectorScheduler,
  CollectionMode,
} from "~/services/collector";
import { RssCollectorFactory } from "~/collectors/rss/factory";

const CollectorLive = Layer.mergeAll(
  CollectorFactoryRegistry.Default,
  CollectorRepository.Default,
  CollectorStateManager.Default,
  CollectorOrchestrator.Default,
  CollectorScheduler.Default,
);

const program = Effect.gen(function* () {
  // 1) Register factory
  const registry = yield* CollectorFactoryRegistry;
  yield* registry.register(RssCollectorFactory);

  // 2) Create a collector entry
  const entry = yield* CollectorRepository.create({
    factoryId: RssCollectorFactory.id,
    name: "BOC RSS",
    description: "Official BOC feed",
    enabled: true,
    schedule: "*/15 * * * *",
    defaultMode: CollectionMode.Incremental({
      since: new Date(Date.now() - 60 * 60 * 1000),
      lookBackWindow: undefined,
    }),
    config: {
      feedUrl: "https://example.com/feed.xml",
      // all other fields are schema-defaulted by RssCollectorConfig
    },
  });

  // 3) Queue one run immediately (returns runId)
  const runId = yield* CollectorOrchestrator.schedule(entry.collectorId);

  // 4) Observe queue/run state
  const queueStatus = yield* CollectorOrchestrator.status;
  const running = yield* CollectorOrchestrator.running;
  const snapshot = yield* CollectorStateManager.getRunSnapshot(runId);

  // 5) Start cron scheduling for all enabled collectors
  yield* CollectorScheduler.startAll;

  return { runId, queueStatus, running, snapshot };
});

// Effect.runPromise(program.pipe(Effect.provide(CollectorLive)))
```

### Runtime Responsibilities

- `CollectorFactoryRegistry`: factory registration + config decoding/instantiation
- `CollectorRepository`: source of collector entries
- `CollectorScheduler`: cron trigger layer
- `CollectorOrchestrator`: execution engine + backpressure handling + run routing
- `CollectorStateManager`: run progress/state store and resume/cancel support

---

## `index.ts`

Barrel export for the collector API.

```ts
import {
  collector,
  CollectorLive,
  CollectorFactoryRegistry,
  CollectorRepository,
  CollectorStateManager,
  CollectorOrchestrator,
  CollectorScheduler,
} from "~/services/collector";
```

---

## Operational Notes

- `CollectorRepository` and `CollectorStateManager` live implementations are currently in-memory.
- `CollectorFactoryRegistry` is runtime/in-memory registration.
- `CollectorScheduler` uses true Effect cron scheduling (`Cron.parse` + `Schedule.cron`).
- Orchestrator behavior is covered by tests in `apps/server/src/services/collector/orchestrator.test.ts`.
- Keep interfaces stable while swapping repository/state internals for production persistence.
