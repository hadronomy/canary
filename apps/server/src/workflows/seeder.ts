import { Context, Data, Effect, Layer } from "effect";
import { Queues } from "../queues/index.js";
import { BocItem } from "../services/boc.js";
import { QueueError, QueueService } from "../services/queue.js";

export class BocArchiveError extends Data.TaggedError("BocArchiveError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BocArchiveService extends Context.Tag("BocArchiveService")<
  BocArchiveService,
  {
    readonly fetchRange: (
      startYear: number,
      endYear: number,
    ) => Effect.Effect<readonly BocItem[], BocArchiveError>;
  }
>() {
  static readonly Live = Layer.succeed(
    BocArchiveService,
    BocArchiveService.of({
      fetchRange: () => Effect.succeed([]),
    }),
  );
}

export class SeederWorkflow extends Context.Tag("SeederWorkflow")<
  SeederWorkflow,
  {
    readonly runSeeder: (options: {
      startYear: number;
      endYear: number;
    }) => Effect.Effect<void, QueueError | BocArchiveError>;
  }
>() {
  static readonly Live = Layer.effect(
    SeederWorkflow,
    Effect.gen(function* () {
      const bocArchiveService = yield* BocArchiveService;
      const queueService = yield* QueueService;

      const runSeeder = Effect.fn(function* (options: { startYear: number; endYear: number }) {
        const items = yield* bocArchiveService.fetchRange(options.startYear, options.endYear);

        yield* Effect.logInfo(`Seeder fetched ${items.length} items`);

        yield* Effect.forEach(items, (item) => queueService.add(Queues.refinery, item), {
          concurrency: 5,
        });

        yield* Effect.logInfo(`Seeder queued ${items.length} items`);
      });

      return { runSeeder };
    }),
  );
}
