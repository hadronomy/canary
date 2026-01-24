import { Context, Effect, Layer, Schedule } from "effect";
import { BocService } from "../services/boc.js";
import { QueueService } from "../services/queue.js";

export class WatcherWorkflow extends Context.Tag("WatcherWorkflow")<
  WatcherWorkflow,
  {
    readonly runWatcher: Effect.Effect<void, unknown>;
    readonly runWatcherScheduled: Effect.Effect<number, unknown>;
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

        yield* Effect.forEach(
          items,
          (item) => queueService.add("refinery-queue", "process-boc-item", item),
          { concurrency: 5 },
        );

        yield* Effect.logInfo(`Watcher queued ${items.length} items`);
      });

      const runWatcherScheduled = Effect.repeat(runWatcher, Schedule.fixed("15 minutes"));

      return { runWatcher, runWatcherScheduled };
    }),
  );
}
