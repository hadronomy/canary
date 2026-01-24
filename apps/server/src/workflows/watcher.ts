import { Context, Effect, Layer, Schedule } from "effect";

import { Queues } from "~/queues/index";
import { BocError, BocService } from "~/services/boc";
import { QueueError, QueueService } from "~/services/queue";

export class WatcherWorkflow extends Context.Tag("@canary/WatcherWorkflow")<
  WatcherWorkflow,
  {
    readonly runWatcher: Effect.Effect<void, BocError | QueueError>;
    readonly runWatcherScheduled: Effect.Effect<void, BocError | QueueError>;
  }
>() {
  static readonly Live = Layer.effect(
    WatcherWorkflow,
    Effect.gen(function* () {
      const bocService = yield* BocService;
      const queueService = yield* QueueService;

      const runWatcher = Effect.fn("WatcherWorkflow.runWatcher")(function* () {
        const items = yield* bocService.fetchFeed();

        yield* Effect.logInfo(`Watcher fetched ${items.length} items`);

        const newItems = items;

        yield* Effect.forEach(newItems, (item) => queueService.add(Queues.refinery, item), {
          concurrency: 5,
        });

        yield* Effect.logInfo(`Watcher queued ${newItems.length} items`);
      });

      const runWatcherScheduled = Effect.repeat(runWatcher(), {
        schedule: Schedule.fixed("15 minutes"),
      }).pipe(Effect.asVoid);

      return { runWatcher: runWatcher(), runWatcherScheduled };
    }),
  );
}
