import { Cron, Duration, Effect, Either, Fiber, HashMap, Metric, Option, Ref } from "effect";

import { ScheduleError } from "./errors";
import {
  collectorScheduledTotal,
  collectorScheduleErrorsTotal,
  collectorScheduleTriggersTotal,
} from "./metrics";
import { CollectorOrchestrator } from "./orchestrator";
import { CollectorRepository } from "./repository";
import type { CollectorId } from "./schema";

export interface ScheduledCollector {
  readonly collectorId: CollectorId;
  readonly schedule: string;
  readonly fiber: Fiber.RuntimeFiber<void, never>;
}

export type ScheduleStartMode = "next_cron" | "immediate_then_cron";

export interface ScheduleStartOptions {
  readonly startMode?: ScheduleStartMode;
}

const SCHEDULER_HEARTBEAT_INTERVAL = Duration.minutes(15);

const parseCron = (
  collectorId: CollectorId,
  cronExpression: string,
): Effect.Effect<Cron.Cron, ScheduleError> =>
  Either.match(Cron.parse(cronExpression), {
    onLeft: (error) =>
      Effect.fail(
        new ScheduleError({
          collectorId,
          schedule: cronExpression,
          reason: error.message,
          message: `Invalid cron expression '${cronExpression}' for collector '${collectorId}'`,
        }),
      ),
    onRight: Effect.succeed,
  });

export class CollectorScheduler extends Effect.Service<CollectorScheduler>()("CollectorScheduler", {
  accessors: true,
  dependencies: [CollectorOrchestrator.Default, CollectorRepository.Default],
  scoped: Effect.gen(function* () {
    const orchestrator = yield* CollectorOrchestrator;
    const repository = yield* CollectorRepository;
    const scheduledRef = yield* Ref.make(HashMap.empty<CollectorId, ScheduledCollector>());
    const heartbeatFiberRef = yield* Ref.make(Option.none<Fiber.RuntimeFiber<void, never>>());

    const syncScheduledGauge = Ref.get(scheduledRef).pipe(
      Effect.flatMap((scheduled) => Metric.set(collectorScheduledTotal, HashMap.size(scheduled))),
    );

    const stop = Effect.fn("CollectorScheduler.stop")((collectorId: CollectorId) =>
      Ref.get(scheduledRef).pipe(
        Effect.flatMap((scheduled) =>
          HashMap.get(scheduled, collectorId).pipe(
            Option.match({
              onNone: () => Effect.void,
              onSome: ({ fiber }) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
            }),
          ),
        ),
        Effect.zipRight(Ref.update(scheduledRef, HashMap.remove(collectorId))),
        Effect.zipRight(syncScheduledGauge),
      ),
    );

    const start = Effect.fn("CollectorScheduler.start")(function* (
      collectorId: CollectorId,
      cronExpression: string,
      options?: ScheduleStartOptions,
    ) {
      const cron = yield* parseCron(collectorId, cronExpression).pipe(
        Effect.tapError((error) =>
          Metric.increment(collectorScheduleErrorsTotal).pipe(
            Effect.tagMetrics({ collector_id: collectorId, error_tag: error._tag }),
          ),
        ),
      );

      yield* stop(collectorId);

      const runScheduledOnce = orchestrator.schedule(collectorId).pipe(
        Effect.tap(() =>
          Metric.increment(collectorScheduleTriggersTotal).pipe(
            Effect.tagMetrics({ collector_id: collectorId }),
          ),
        ),
        Effect.catchAll((error) =>
          Metric.increment(collectorScheduleErrorsTotal).pipe(
            Effect.tagMetrics({ collector_id: collectorId, error_tag: error._tag }),
            Effect.zipRight(
              Effect.logError("Scheduled collector run failed", {
                collectorId,
                error: error.message,
              }),
            ),
          ),
        ),
      );

      const sleepUntilNextCron = Effect.sync(() => {
        const nextRunAt = Cron.next(cron, new Date());
        return Math.max(0, nextRunAt.getTime() - Date.now());
      }).pipe(Effect.flatMap((delayMs) => Effect.sleep(Duration.millis(delayMs))));

      const scheduledTask = Effect.gen(function* () {
        const startMode = options?.startMode ?? "next_cron";

        if (startMode === "immediate_then_cron") {
          yield* runScheduledOnce;
        }

        while (true) {
          yield* sleepUntilNextCron;
          yield* runScheduledOnce;
        }
      }).pipe(Effect.asVoid);

      const fiber = yield* Effect.forkDaemon(scheduledTask);

      yield* Ref.update(
        scheduledRef,
        HashMap.set(collectorId, {
          collectorId,
          schedule: cronExpression,
          fiber,
        }),
      );
      yield* syncScheduledGauge;
    });

    const startAll = repository
      .findMany({ _tag: "Enabled" })
      .pipe(
        Effect.flatMap((collectors) =>
          Effect.forEach(
            collectors,
            (collector) => start(collector.collectorId, collector.schedule),
            { discard: true },
          ),
        ),
      );

    const stopAll = Effect.gen(function* () {
      const scheduled = yield* Ref.get(scheduledRef);
      yield* Effect.forEach(Array.from(HashMap.keys(scheduled)), stop, { discard: true });

      const heartbeatFiber = yield* Ref.get(heartbeatFiberRef);
      if (Option.isSome(heartbeatFiber)) {
        yield* Fiber.interrupt(heartbeatFiber.value).pipe(Effect.asVoid);
        yield* Ref.set(heartbeatFiberRef, Option.none());
      }
    });

    const reschedule = Effect.fn("CollectorScheduler.reschedule")(
      (collectorId: CollectorId, schedule: string, options?: ScheduleStartOptions) =>
        start(collectorId, schedule, options),
    );

    const triggerNow = Effect.fn("CollectorScheduler.triggerNow")((collectorId: CollectorId) =>
      orchestrator.schedule(collectorId),
    );

    const scheduled = Ref.get(scheduledRef).pipe(
      Effect.map((scheduledMap) =>
        Array.from(HashMap.values(scheduledMap)).map(({ collectorId, schedule }) => ({
          collectorId,
          schedule,
        })),
      ),
    );

    const heartbeat = Effect.forever(
      Effect.sleep(SCHEDULER_HEARTBEAT_INTERVAL).pipe(
        Effect.zipRight(
          scheduled.pipe(
            Effect.flatMap((entries) =>
              Effect.logInfo("Collector scheduler heartbeat", {
                scheduledCollectors: entries.length,
                schedules: entries,
              }),
            ),
          ),
        ),
      ),
    ).pipe(Effect.asVoid);

    const heartbeatFiber = yield* Effect.forkDaemon(heartbeat);
    yield* Ref.set(heartbeatFiberRef, Option.some(heartbeatFiber));

    yield* Effect.addFinalizer(() => stopAll);

    return {
      start,
      stop,
      startAll,
      stopAll,
      reschedule,
      triggerNow,
      scheduled,
    };
  }),
}) {}
