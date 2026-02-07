import { DateTime, Effect, Fiber, HashMap, Metric, Option, Queue, Ref, Stream } from "effect";

import type { Collector } from "./collector";
import { CollectionError, ResumeError, type CollectorError } from "./errors";
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
  CollectionMode,
  CollectionRunId,
  CollectionStats,
  CollectorId,
  CollectionCursor,
  CollectedDocument,
} from "./schema";
import { CollectionMode as CollectionModeTag, CollectionProgress } from "./schema";
import { CollectorStateManager } from "./state";

const ENQUEUE_TIMEOUT_MS = 5_000;

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
  readonly lastDocumentDate: Option.Option<Date>;
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
  current: Option.Option<Date>,
  documents: ReadonlyArray<CollectedDocument>,
): Option.Option<Date> => {
  let latest = current;
  for (const document of documents) {
    const publishedAt = new Date(document.publishedAt.toString());
    latest = Option.match(latest, {
      onNone: () => Option.some(publishedAt),
      onSome: (existing) => Option.some(existing > publishedAt ? existing : publishedAt),
    });
  }
  return latest;
};

export class CollectorOrchestrator extends Effect.Service<CollectorOrchestrator>()(
  "CollectorOrchestrator",
  {
    accessors: true,
    dependencies: [
      CollectorFactoryRegistry.Default,
      CollectorRepository.Default,
      CollectorStateManager.Default,
    ],
    effect: Effect.gen(function* () {
      const registry = yield* CollectorFactoryRegistry;
      const repository = yield* CollectorRepository;
      const stateManager = yield* CollectorStateManager;
      const queue = yield* Queue.bounded<CollectionJob>(128);
      const runningRef = yield* Ref.make(HashMap.empty<CollectionRunId, RunningCollector>());

      const syncQueueDepth = Queue.size(queue).pipe(
        Effect.flatMap((pending) => Metric.set(collectorQueueDepth, pending)),
      );

      const instantiateCollector = (collectorId: CollectorId) =>
        Effect.gen(function* () {
          const entry = yield* repository.findOne(collectorId);
          const collector = yield* registry.instantiate(entry);
          return { collector, entry };
        });

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
              duration: ENQUEUE_TIMEOUT_MS,
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
        });

      const processCollector = (
        collector: Collector,
        mode: CollectionMode,
        runId: CollectionRunId,
      ) =>
        Effect.gen(function* () {
          const withRunTags = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(Effect.tagMetrics({ collector_id: collector.id, mode: mode._tag }));

          yield* withRunTags(Metric.increment(collectorRunsStartedTotal));
          yield* withRunTags(Metric.increment(collectorActiveRuns));

          const startedAt = DateTime.unsafeNow();

          const statsAcc = yield* collector.collect(mode, runId).pipe(
            Stream.runFoldEffect(initialAccumulator, (acc, batch) =>
              Effect.gen(function* () {
                const batchTotals = batch.documents.reduce(
                  (totals, document) => ({
                    processed: totals.processed + 1,
                    inserted: totals.inserted + (document.kind === "New" ? 1 : 0),
                    updated: totals.updated + (document.kind === "Update" ? 1 : 0),
                    skipped: totals.skipped + (document.kind === "Unchanged" ? 1 : 0),
                  }),
                  { processed: 0, inserted: 0, updated: 0, skipped: 0 },
                );

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

                yield* stateManager.updateProgress(
                  runId,
                  new CollectionProgress({
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
                  }),
                );

                return nextAcc;
              }),
            ),
          );

          const endedAt = DateTime.unsafeNow();
          const stats: CollectionStats = {
            processed: statsAcc.processed,
            inserted: statsAcc.inserted,
            updated: statsAcc.updated,
            skipped: statsAcc.skipped,
            failed: statsAcc.failed,
            duration: Math.max(0, endedAt.epochMillis - startedAt.epochMillis),
          };

          yield* stateManager.updateState(collector.id, {
            mode,
            documentsCollected: statsAcc.processed,
            lastDocumentDate: statsAcc.lastDocumentDate,
            cursor: Option.map(statsAcc.lastCursor, (cursor) => ({ value: cursor.value })),
          });

          yield* stateManager.completeRun(runId, stats);
          yield* withRunTags(Metric.increment(collectorRunsCompletedTotal));
          yield* withRunTags(Metric.update(collectorRunDurationMs, stats.duration));
          yield* Effect.logInfo("Collector run completed", {
            collectorId: collector.id,
            runId,
            processed: stats.processed,
            durationMs: stats.duration,
          });
          return stats;
        }).pipe(
          Effect.tapError((error) => {
            const message = "message" in error ? String(error.message) : String(error);
            const errorTag = "_tag" in error ? String(error._tag) : "UnknownError";
            return stateManager.failRun(runId, message, Option.none(), true).pipe(
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
                  Effect.catchTag("CollectionError", () => Effect.void),
                ),
            ),
          );
        }).pipe(
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
            Metric.increment(collectorRunErrorsTotal).pipe(
              Effect.tagMetrics({ collector_id: "unknown", error_tag: "UnhandledCause" }),
              Effect.zipRight(
                Effect.logError("Unhandled orchestrator worker error", { cause: cause.toString() }),
              ),
            ),
          ),
        ),
      );

      yield* Effect.forkDaemon(workerLoop);

      const schedule = Effect.fn("CollectorOrchestrator.schedule")(function* (
        collectorId: CollectorId,
      ) {
        const { entry } = yield* instantiateCollector(collectorId);
        const runId = yield* stateManager.createRun(collectorId, entry.defaultMode);
        return yield* enqueueJob({ _tag: "Run", runId, collectorId, mode: entry.defaultMode });
      });

      const scheduleExplicit = Effect.fn("CollectorOrchestrator.scheduleExplicit")(function* (
        collectorId: CollectorId,
        mode: CollectionMode,
      ) {
        yield* instantiateCollector(collectorId);
        const runId = yield* stateManager.createRun(collectorId, mode);
        return yield* enqueueJob({ _tag: "Run", runId, collectorId, mode });
      });

      const collectNow = Effect.fn("CollectorOrchestrator.collectNow")(function* (
        collectorId: CollectorId,
        mode: CollectionMode,
      ) {
        const { collector } = yield* instantiateCollector(collectorId);
        const runId = yield* stateManager.createRun(collectorId, mode);
        return yield* processCollector(collector, mode, runId);
      });

      const resume = Effect.fn("CollectorOrchestrator.resume")(function* (
        collectorId: CollectorId,
        runId: CollectionRunId,
      ) {
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

      const cancel = Effect.fn("CollectorOrchestrator.cancel")(
        (runId: CollectionRunId, reason?: string) =>
          Ref.get(runningRef).pipe(
            Effect.flatMap((running) =>
              HashMap.get(running, runId).pipe(
                Option.match({
                  onNone: () => Effect.void,
                  onSome: ({ fiber, collectorId, mode }) =>
                    Fiber.interrupt(fiber).pipe(
                      Effect.zipRight(
                        stateManager.cancelRun(runId, Option.fromNullable(reason), Option.none()),
                      ),
                      Effect.zipRight(
                        Metric.increment(collectorRunsCancelledTotal).pipe(
                          Effect.tagMetrics({ collector_id: collectorId, mode: mode._tag }),
                        ),
                      ),
                    ),
                }),
              ),
            ),
            Effect.catchTag("CollectionError", () => Effect.void),
          ),
      );

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
