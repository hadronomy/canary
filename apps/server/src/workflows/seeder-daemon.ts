import { Context, Effect, Layer, Schedule } from "effect";

import { QueueError } from "~/services/queue";
import { BocArchiveError, SeederWorkflow } from "~/workflows/seeder";

export class SeederDaemon extends Context.Tag("SeederDaemon")<
  SeederDaemon,
  {
    readonly runOnce: (options: {
      startYear: number;
      endYear: number;
    }) => Effect.Effect<void, QueueError | BocArchiveError>;
    readonly runScheduled: (
      options: {
        startYear: number;
        endYear: number;
      },
      schedule: Schedule.Schedule<unknown, void>,
    ) => Effect.Effect<void, QueueError | BocArchiveError>;
  }
>() {
  static readonly Live = Layer.effect(
    SeederDaemon,
    Effect.gen(function* () {
      const seederWorkflow = yield* SeederWorkflow;

      const runOnce = Effect.fn("SeederDaemon.runOnce")(function* (options: {
        startYear: number;
        endYear: number;
      }) {
        yield* seederWorkflow.runSeeder(options);
      });

      const runScheduled = Effect.fn("SeederDaemon.runScheduled")(function* (
        options: { startYear: number; endYear: number },
        schedule: Schedule.Schedule<unknown, void>,
      ) {
        yield* Effect.repeat(runOnce(options), schedule);
      });

      return { runOnce, runScheduled };
    }),
  );
}
