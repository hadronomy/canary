import { Context, Effect, Layer, Schedule } from "effect";
import { Queues } from "~/queues/index";
import { BocError, BocService } from "~/services/boc";
import { QueueError, QueueService } from "~/services/queue";

export class WatcherWorkflow extends Context.Tag("WatcherWorkflow")<
  WatcherWorkflow,
  {
    readonly runWatcher: Effect.Effect<void, BocError | QueueError>;
    readonly runWatcherScheduled: Effect.Effect<number, BocError | QueueError>;
  }
>() {
  static readonly Live = Layer.effect(
    WatcherWorkflow,
    Effect.gen(function* () {
      const bocService = yield* BocService;
      const queueService = yield* QueueService;

      const runWatcher = Effect.gen(function* () {
        const items = yield* bocService.fetchFeed();

        yield* Effect.logInfo(`Watcher fetched ${items.length} items`);

        const newItems = items;

        yield* Effect.forEach(newItems, (item) => queueService.add(Queues.refinery, item), {
          concurrency: 5,
        });

        yield* Effect.logInfo(`Watcher queued ${newItems.length} items`);
      });

      const runWatcherScheduled = Effect.repeat(runWatcher, Schedule.fixed("15 minutes"));

      return { runWatcher, runWatcherScheduled };
    }),
  );
}
