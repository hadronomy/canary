import { Cron, Effect, Either, Fiber, HashMap, Metric, Option, Ref, Schedule } from "effect";

import { ScheduleError } from "./errors";
import {
  collectorScheduleErrorsTotal,
  collectorScheduledTotal,
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
  effect: Effect.gen(function* () {
    const orchestrator = yield* CollectorOrchestrator;
    const repository = yield* CollectorRepository;
    const scheduledRef = yield* Ref.make(HashMap.empty<CollectorId, ScheduledCollector>());

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
    ) {
      const cron = yield* parseCron(collectorId, cronExpression).pipe(
        Effect.tapError((error) =>
          Metric.increment(collectorScheduleErrorsTotal).pipe(
            Effect.tagMetrics({ collector_id: collectorId, error_tag: error._tag }),
          ),
        ),
      );

      yield* stop(collectorId);

      const scheduledTask = orchestrator.schedule(collectorId).pipe(
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
        Effect.repeat(Schedule.cron(cron)),
        Effect.asVoid,
      );

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

    const stopAll = Ref.get(scheduledRef).pipe(
      Effect.flatMap((scheduled) =>
        Effect.forEach(Array.from(HashMap.keys(scheduled)), stop, { discard: true }),
      ),
    );

    const reschedule = Effect.fn("CollectorScheduler.reschedule")(
      (collectorId: CollectorId, schedule: string) => start(collectorId, schedule),
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
