import {
  Cause,
  DateTime,
  Duration,
  Effect,
  Fiber,
  HashMap,
  Metric,
  Option,
  Queue,
  Ref,
  Stream,
} from "effect";

import type { Collector } from "./collector";
import { CollectionError, ResumeError, type CollectorError } from "./errors";
import { CollectorEventBus } from "./event-bus";
import { CancelledEvent, FailedEvent } from "./events";
import { CollectorFactoryRegistry } from "./factory";
import {
  collectorActiveRuns,
  collectorBatchSize,
  collectorDocumentsInsertedTotal,
  collectorDocumentsProcessedTotal,
  collectorDocumentsSkippedTotal,
  collectorDocumentsUpdatedTotal,
  collectorProgressUpdatesTotal,
  collectorQueueDepth,
  collectorQueueOfferTimeoutTotal,
  collectorRunDurationMs,
  collectorRunErrorsTotal,
  collectorRunsCancelledTotal,
  collectorRunsCompletedTotal,
  collectorRunsFailedTotal,
  collectorRunsStartedTotal,
} from "./metrics";
import { CollectorRepository } from "./repository";
import type {
  CollectedDocument,
  CollectionCursor,
  CollectionMode,
  CollectionRunId,
  CollectionStats,
  CollectorId,
} from "./schema";
import { CollectionMode as CollectionModeTag, CollectionProgress } from "./schema";
import { CollectorStateManager } from "./state";

const ENQUEUE_TIMEOUT = Duration.seconds(5);
const WORKER_CONCURRENCY = 4;

export interface CollectionJob {
  readonly _tag: "Run";
  readonly runId: CollectionRunId;
  readonly collectorId: CollectorId;
  readonly mode: CollectionMode;
}

export interface RunningCollector {
  readonly collectorId: CollectorId;
  readonly runId: CollectionRunId;
  readonly mode: CollectionMode;
  readonly startedAt: DateTime.Utc;
  readonly fiber: Fiber.RuntimeFiber<CollectionStats, CollectorError>;
}

export interface QueueStatus {
  readonly pending: number;
  readonly running: number;
}

interface RunAccumulator {
  readonly processed: number;
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly lastCursor: Option.Option<CollectionCursor>;
  readonly lastDocumentDate: Option.Option<DateTime.Utc>;
}

const initialAccumulator: RunAccumulator = {
  processed: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  lastCursor: Option.none(),
  lastDocumentDate: Option.none(),
};

const updateLastDocumentDate = (
  current: Option.Option<DateTime.Utc>,
  documents: ReadonlyArray<CollectedDocument>,
): Option.Option<DateTime.Utc> => {
  let latest = current;
  for (const document of documents) {
    const publishedAt = document.publishedAt;
    latest = Option.match(latest, {
      onNone: () => Option.some(publishedAt),
      onSome: (existing) =>
        Option.some(existing.epochMillis > publishedAt.epochMillis ? existing : publishedAt),
    });
  }
  return latest;
};

export class CollectorOrchestrator extends Effect.Service<CollectorOrchestrator>()(
  "CollectorOrchestrator",
  {
    accessors: true,
    dependencies: [
      CollectorRepository.Default,
      CollectorStateManager.Default,
      CollectorEventBus.Default,
    ],
    scoped: Effect.gen(function* () {
      const registry = yield* CollectorFactoryRegistry;
      const repository = yield* CollectorRepository;
      const stateManager = yield* CollectorStateManager;
      const eventBus = yield* CollectorEventBus;
      const queue = yield* Queue.bounded<CollectionJob>(128);
      const runningRef = yield* Ref.make(HashMap.empty<CollectionRunId, RunningCollector>());
      const workerFibersRef = yield* Ref.make<Array<Fiber.RuntimeFiber<void, never>>>([]);

      const syncQueueDepth = Queue.size(queue).pipe(
        Effect.flatMap((pending) => Metric.set(collectorQueueDepth, pending)),
        Effect.withSpan("CollectorOrchestrator.syncQueueDepth"),
      );

      const instantiateCollector = (collectorId: CollectorId) =>
        Effect.gen(function* () {
          const entry = yield* repository.findOne(collectorId);
          const collector = yield* registry.instantiate(entry);
          return { collector, entry };
        });

      const findCollectorEntry = (collectorId: CollectorId) => repository.findOne(collectorId);

      const enqueueJob = (job: CollectionJob) =>
        Effect.gen(function* () {
          yield* Queue.offer(queue, job).pipe(
            Effect.timeoutFail({
              onTimeout: () =>
                new CollectionError({
                  collectorId: job.collectorId,
                  runId: job.runId,
                  reason: "Queue offer timed out due to backpressure",
                  message: `Queue offer timed out for collector '${job.collectorId}'`,
                }),
              duration: ENQUEUE_TIMEOUT,
            }),
            Effect.tapError(() =>
              Metric.increment(collectorQueueOfferTimeoutTotal).pipe(
                Effect.tagMetrics({
                  collector_id: job.collectorId,
                  mode: job.mode._tag,
                }),
              ),
            ),
          );
          yield* syncQueueDepth;
          return job.runId;
        }).pipe(Effect.withSpan("CollectorOrchestrator.enqueueJob"));

      const processCollector = (
        collector: Collector,
        mode: CollectionMode,
        runId: CollectionRunId,
      ) =>
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan("collector.id", collector.id);
          yield* Effect.annotateCurrentSpan("collector.factoryId", collector.factoryId);
          yield* Effect.annotateCurrentSpan("run.id", runId);
          yield* Effect.annotateCurrentSpan("run.mode", mode._tag);

          const withRunTags = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(Effect.tagMetrics({ collector_id: collector.id, mode: mode._tag }));

          yield* withRunTags(Metric.increment(collectorRunsStartedTotal));
          yield* withRunTags(Metric.increment(collectorActiveRuns));

          const startedAt = DateTime.unsafeNow();
          yield* Effect.annotateCurrentSpan("run.startedAt", startedAt.epochMillis);

          const statsAcc = yield* collector.collect(mode, runId).pipe(
            Stream.withSpan("CollectorOrchestrator.collectStream"),
            Stream.runFoldEffect(initialAccumulator, (acc, batch) =>
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan("batch.size", batch.documents.length);

                const batchTotals = batch.documents.reduce(
                  (totals, document) => ({
                    processed: totals.processed + 1,
                    inserted: totals.inserted + (document.kind === "New" ? 1 : 0),
                    updated: totals.updated + (document.kind === "Update" ? 1 : 0),
                    skipped: totals.skipped + (document.kind === "Unchanged" ? 1 : 0),
                  }),
                  { processed: 0, inserted: 0, updated: 0, skipped: 0 },
                );

                yield* Effect.annotateCurrentSpan("batch.processed", batchTotals.processed);
                yield* Effect.annotateCurrentSpan("batch.inserted", batchTotals.inserted);
                yield* Effect.annotateCurrentSpan("batch.updated", batchTotals.updated);

                yield* withRunTags(
                  Metric.incrementBy(collectorDocumentsProcessedTotal, batchTotals.processed),
                );
                yield* withRunTags(
                  Metric.incrementBy(collectorDocumentsInsertedTotal, batchTotals.inserted),
                );
                yield* withRunTags(
                  Metric.incrementBy(collectorDocumentsUpdatedTotal, batchTotals.updated),
                );
                yield* withRunTags(
                  Metric.incrementBy(collectorDocumentsSkippedTotal, batchTotals.skipped),
                );
                yield* withRunTags(Metric.update(collectorBatchSize, batch.documents.length));
                yield* withRunTags(Metric.increment(collectorProgressUpdatesTotal));

                const nextAcc: RunAccumulator = {
                  ...acc,
                  processed: acc.processed + batchTotals.processed,
                  inserted: acc.inserted + batchTotals.inserted,
                  updated: acc.updated + batchTotals.updated,
                  skipped: acc.skipped + batchTotals.skipped,
                  lastCursor: batch.cursor,
                  lastDocumentDate: updateLastDocumentDate(acc.lastDocumentDate, batch.documents),
                };

                yield* Effect.annotateCurrentSpan("total.processed", nextAcc.processed);
                yield* Effect.annotateCurrentSpan("total.inserted", nextAcc.inserted);
                yield* Effect.annotateCurrentSpan("total.updated", nextAcc.updated);

                const progress = new CollectionProgress({
                  runId,
                  collectorId: collector.id,
                  mode,
                  cursor: nextAcc.lastCursor,
                  processed: nextAcc.processed,
                  inserted: nextAcc.inserted,
                  updated: nextAcc.updated,
                  skipped: nextAcc.skipped,
                  failed: nextAcc.failed,
                  startedAt,
                  lastProgressAt: DateTime.unsafeNow(),
                  estimatedTotal: Option.none(),
                  estimatedCompletion: Option.none(),
                });

                yield* stateManager.updateProgress(runId, progress);

                yield* eventBus.publish({
                  _tag: "Progress" as const,
                  runId,
                  collectorId: collector.id,
                  timestamp: DateTime.unsafeNow(),
                  progress,
                });

                return nextAcc;
              }).pipe(Effect.withSpan("CollectorOrchestrator.processBatch")),
            ),
          );

          const endedAt = DateTime.unsafeNow();
          const stats: CollectionStats = {
            processed: statsAcc.processed,
            inserted: statsAcc.inserted,
            updated: statsAcc.updated,
            skipped: statsAcc.skipped,
            failed: statsAcc.failed,
            duration: Duration.millis(Math.max(0, endedAt.epochMillis - startedAt.epochMillis)),
          };

          yield* Effect.annotateCurrentSpan("run.completedAt", endedAt.epochMillis);
          yield* Effect.annotateCurrentSpan("run.durationMs", Duration.toMillis(stats.duration));
          yield* Effect.annotateCurrentSpan("run.totalProcessed", stats.processed);
          yield* Effect.annotateCurrentSpan("run.totalInserted", stats.inserted);
          yield* Effect.annotateCurrentSpan("run.totalUpdated", stats.updated);

          yield* stateManager.updateState(collector.id, {
            mode,
            documentsCollected: statsAcc.processed,
            lastDocumentDate: statsAcc.lastDocumentDate,
            cursor: Option.map(statsAcc.lastCursor, (cursor) => ({ value: cursor.value })),
          });

          yield* stateManager.completeRun(runId, stats);
          yield* withRunTags(Metric.increment(collectorRunsCompletedTotal));
          yield* withRunTags(
            Metric.update(collectorRunDurationMs, Duration.toMillis(stats.duration)),
          );

          yield* eventBus.publish({
            _tag: "Completed" as const,
            runId,
            collectorId: collector.id,
            timestamp: DateTime.unsafeNow(),
            stats,
          });

          yield* Effect.logInfo("Collector run completed", {
            collectorId: collector.id,
            runId,
            processed: stats.processed,
            durationMs: Duration.toMillis(stats.duration),
          });
          return stats;
        }).pipe(
          Effect.withSpan("CollectorOrchestrator.processCollector"),
          Effect.tapError((error) => {
            const message = "message" in error ? String(error.message) : String(error);
            const errorTag = "_tag" in error ? String(error._tag) : "UnknownError";
            const retryable = true;

            return stateManager.failRun(runId, message, Option.none(), retryable).pipe(
              Effect.zipRight(
                Metric.increment(collectorRunsFailedTotal).pipe(
                  Effect.tagMetrics({ collector_id: collector.id, mode: mode._tag }),
                ),
              ),
              Effect.zipRight(
                Metric.increment(collectorRunErrorsTotal).pipe(
                  Effect.tagMetrics({ collector_id: collector.id, mode: mode._tag }),
                  Effect.tagMetrics({ error_tag: errorTag }),
                ),
              ),
              Effect.zipRight(
                eventBus.publish(
                  new FailedEvent({
                    runId,
                    collectorId: collector.id,
                    timestamp: DateTime.unsafeNow(),
                    error: message,
                    retryable,
                    progress: Option.none(),
                  }),
                ),
              ),
              Effect.zipRight(
                Effect.logError("Collector run failed", {
                  collectorId: collector.id,
                  runId,
                  error: message,
                }),
              ),
            );
          }),
          Effect.ensuring(
            Metric.incrementBy(collectorActiveRuns, -1).pipe(
              Effect.tagMetrics({ collector_id: collector.id, mode: mode._tag }),
            ),
          ),
        );

      const workerLoop = Effect.forever(
        Effect.gen(function* () {
          const job = yield* Queue.take(queue);
          yield* Effect.annotateCurrentSpan("job.collectorId", job.collectorId);
          yield* Effect.annotateCurrentSpan("job.runId", job.runId);
          yield* syncQueueDepth;
          const { collector } = yield* instantiateCollector(job.collectorId);
          const startedAt = DateTime.unsafeNow();
          const fiber = yield* Effect.fork(processCollector(collector, job.mode, job.runId));

          yield* Ref.update(
            runningRef,
            HashMap.set(job.runId, {
              collectorId: collector.id,
              runId: job.runId,
              mode: job.mode,
              startedAt,
              fiber,
            }),
          );

          yield* Fiber.join(fiber).pipe(
            Effect.ensuring(
              Ref.update(runningRef, HashMap.remove(job.runId)).pipe(
                Effect.zipRight(syncQueueDepth),
              ),
            ),
            Effect.onInterrupt(() =>
              stateManager
                .cancelRun(job.runId, Option.some("Worker interrupted"), Option.none())
                .pipe(
                  Effect.zipRight(
                    Metric.increment(collectorRunsCancelledTotal).pipe(
                      Effect.tagMetrics({ collector_id: job.collectorId, mode: job.mode._tag }),
                    ),
                  ),
                  Effect.zipRight(
                    eventBus.publish(
                      new CancelledEvent({
                        runId: job.runId,
                        collectorId: job.collectorId,
                        timestamp: DateTime.unsafeNow(),
                        reason: "Worker interrupted",
                        progress: Option.none(),
                      }),
                    ),
                  ),
                  Effect.catchTag("CollectionError", () => Effect.void),
                ),
            ),
          );
        }).pipe(
          Effect.withSpan("CollectorOrchestrator.workerLoop"),
          Effect.catchTags({
            CollectorNotFoundError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collector not found", { collectorId: error.collectorId }),
                ),
              ),
            FactoryNotFoundError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: "unknown", error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collector factory not found", { factoryId: error.factoryId }),
                ),
              ),
            ConfigValidationError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collector config invalid", {
                    collectorId: error.collectorId,
                    issues: error.issues,
                  }),
                ),
              ),
            CollectionError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collection failed", {
                    collectorId: error.collectorId,
                    runId: error.runId,
                    reason: error.reason,
                  }),
                ),
              ),
            SourceConnectionError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Source connection failed", {
                    collectorId: error.collectorId,
                    sourceUrl: error.sourceUrl,
                  }),
                ),
              ),
            ScheduleError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Schedule error in orchestrator", {
                    collectorId: error.collectorId,
                    schedule: error.schedule,
                  }),
                ),
              ),
            ModeNotSupportedError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Mode not supported", {
                    collectorId: error.collectorId,
                    requestedMode: error.requestedMode,
                  }),
                ),
              ),
            ResumeError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Resume failed", {
                    collectorId: error.collectorId,
                    runId: error.runId,
                    reason: error.reason,
                  }),
                ),
              ),
            ValidationError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collector validation error", {
                    collectorId: error.collectorId,
                    field: error.field,
                  }),
                ),
              ),
            HealthCheckError: (error) =>
              Metric.increment(collectorRunErrorsTotal).pipe(
                Effect.tagMetrics({ collector_id: error.collectorId, error_tag: error._tag }),
                Effect.zipRight(
                  Effect.logError("Collector health check error", {
                    collectorId: error.collectorId,
                    reason: error.reason,
                  }),
                ),
              ),
          }),
          Effect.catchAllCause((cause) =>
            Cause.isInterruptedOnly(cause)
              ? Effect.void
              : Metric.increment(collectorRunErrorsTotal).pipe(
                  Effect.tagMetrics({ collector_id: "unknown", error_tag: "UnhandledCause" }),
                  Effect.zipRight(
                    Effect.logError("Unhandled orchestrator worker error", {
                      cause: cause.toString(),
                    }),
                  ),
                ),
          ),
        ),
      );

      const workerFibers = yield* Effect.forEach(
        Array.from({ length: WORKER_CONCURRENCY }),
        (_, i) =>
          Effect.forkDaemon(
            Effect.gen(function* () {
              yield* Effect.logInfo(`Worker ${i} starting`);
              yield* Effect.annotateCurrentSpan("worker.index", i);
              return yield* workerLoop.pipe(
                Effect.tapError((error) =>
                  Effect.logError(`Worker ${i} error`, { error: String(error) }),
                ),
              );
            }).pipe(
              Effect.withSpan("CollectorOrchestrator.worker", {
                attributes: { workerIndex: i },
              }),
            ),
          ),
        {
          discard: false,
        },
      );
      yield* Ref.set(workerFibersRef, workerFibers);

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const running = yield* Ref.get(runningRef);
          yield* Effect.forEach(
            Array.from(HashMap.values(running)),
            ({ fiber }) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
            { discard: true },
          );

          const workerFibers = yield* Ref.get(workerFibersRef);
          yield* Effect.forEach(
            workerFibers,
            (workerFiber) => Fiber.interrupt(workerFiber).pipe(Effect.asVoid),
            { discard: true },
          );
          yield* Ref.set(workerFibersRef, []);
        }),
      );

      const schedule = Effect.fn("CollectorOrchestrator.schedule")(function* (
        collectorId: CollectorId,
      ) {
        yield* Effect.annotateCurrentSpan("collector.id", collectorId);

        const entry = yield* findCollectorEntry(collectorId);
        const { collector } = yield* instantiateCollector(collectorId);

        const state = yield* collector.estimateState();
        const mode = Option.match(state.lastDocumentDate, {
          onNone: () => entry.defaultMode,
          onSome: (latestDate) =>
            CollectionModeTag.Incremental({
              since: latestDate,
              lookBackWindow: Duration.days(1),
            }),
        });

        yield* Effect.annotateCurrentSpan("run.mode", mode._tag);
        if (mode._tag === "Incremental") {
          yield* Effect.logInfo("Using incremental mode based on existing documents", {
            collectorId,
            since: mode.since.toISOString(),
          });
        }

        const runId = yield* stateManager.createRun(collectorId, mode);
        yield* Effect.annotateCurrentSpan("run.id", runId);

        return yield* enqueueJob({ _tag: "Run", runId, collectorId, mode }).pipe(
          Effect.tapError((error) =>
            stateManager.failRun(
              runId,
              "Failed to enqueue run",
              Option.none(),
              "_tag" in error ? error._tag !== "CollectionError" : true,
            ),
          ),
        );
      });

      const scheduleExplicit = Effect.fn("CollectorOrchestrator.scheduleExplicit")(function* (
        collectorId: CollectorId,
        mode: CollectionMode,
      ) {
        yield* Effect.annotateCurrentSpan("collector.id", collectorId);
        yield* Effect.annotateCurrentSpan("run.mode", mode._tag);

        yield* findCollectorEntry(collectorId);
        const runId = yield* stateManager.createRun(collectorId, mode);

        yield* Effect.annotateCurrentSpan("run.id", runId);

        return yield* enqueueJob({ _tag: "Run", runId, collectorId, mode }).pipe(
          Effect.tapError((error) =>
            stateManager.failRun(
              runId,
              "Failed to enqueue run",
              Option.none(),
              "_tag" in error ? error._tag !== "CollectionError" : true,
            ),
          ),
        );
      });

      const collectNow = Effect.fn("CollectorOrchestrator.collectNow")(function* (
        collectorId: CollectorId,
        mode: CollectionMode,
      ) {
        yield* Effect.annotateCurrentSpan("collector.id", collectorId);
        yield* Effect.annotateCurrentSpan("run.mode", mode._tag);

        const { collector } = yield* instantiateCollector(collectorId);
        const runId = yield* stateManager.createRun(collectorId, mode);

        yield* Effect.annotateCurrentSpan("run.id", runId);

        return yield* processCollector(collector, mode, runId);
      });

      const resume = Effect.fn("CollectorOrchestrator.resume")(function* (
        collectorId: CollectorId,
        runId: CollectionRunId,
      ) {
        yield* Effect.annotateCurrentSpan("collector.id", collectorId);
        yield* Effect.annotateCurrentSpan("run.id", runId);

        const snapshot = yield* stateManager.getRunSnapshot(runId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new ResumeError({
                    collectorId,
                    runId,
                    reason: "Run snapshot not found",
                    message: `Run snapshot '${runId}' not found for '${collectorId}'`,
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );

        if (snapshot.run.collectorId !== collectorId) {
          return yield* new ResumeError({
            collectorId,
            runId,
            reason: "Run does not belong to collector",
            message: `Run '${runId}' does not belong to collector '${collectorId}'`,
          });
        }

        const cursor = Option.match(snapshot.progress, {
          onNone: () => "",
          onSome: (progress) =>
            Option.match(progress.cursor, {
              onNone: () => "",
              onSome: (value) => value.value,
            }),
        });

        const resumeMode = CollectionModeTag.Resume({
          originalMode: snapshot.run.mode,
          cursor,
          runId,
        });

        const { collector } = yield* instantiateCollector(collectorId);
        return yield* processCollector(collector, resumeMode, runId);
      });

      const collectAll = repository.findMany({ _tag: "Enabled" }).pipe(
        Effect.flatMap((entries) =>
          Effect.forEach(entries, (entry) => schedule(entry.collectorId), {
            discard: false,
          }),
        ),
      );

      const cancel = Effect.fn("CollectorOrchestrator.cancel")(function* (
        runId: CollectionRunId,
        reason?: string,
      ) {
        yield* Effect.annotateCurrentSpan("run.id", runId);
        yield* Effect.annotateCurrentSpan("cancel.reason", reason ?? "not_specified");

        const running = yield* Ref.get(runningRef);
        return yield* HashMap.get(running, runId).pipe(
          Option.match({
            onNone: () => Effect.void,
            onSome: ({ fiber, collectorId, mode }) =>
              Fiber.interrupt(fiber).pipe(
                Effect.zipRight(
                  stateManager
                    .cancelRun(runId, Option.fromNullable(reason), Option.none())
                    .pipe(Effect.catchTag("CollectionError", () => Effect.void)),
                ),
                Effect.zipRight(
                  Metric.increment(collectorRunsCancelledTotal).pipe(
                    Effect.tagMetrics({ collector_id: collectorId, mode: mode._tag }),
                  ),
                ),
                Effect.zipRight(
                  eventBus.publish(
                    new CancelledEvent({
                      runId,
                      collectorId,
                      timestamp: DateTime.unsafeNow(),
                      reason,
                      progress: Option.none(),
                    }),
                  ),
                ),
              ),
          }),
        );
      });

      const status = Effect.all({
        pending: Queue.size(queue),
        running: Ref.get(runningRef).pipe(Effect.map(HashMap.size)),
      });

      const running = Ref.get(runningRef).pipe(
        Effect.map((map) => Array.from(HashMap.values(map))),
      );

      return {
        schedule,
        scheduleExplicit,
        collectNow,
        resume,
        collectAll,
        cancel,
        status,
        running,
      };
    }),
  },
) {}
