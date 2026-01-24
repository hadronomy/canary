import { Context, Effect, Layer, Schedule } from "effect";
import { BocArchiveError, SeederWorkflow } from "./seeder.js";
import { QueueError } from "../services/queue.js";

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
      schedule: Schedule.Schedule<number, unknown>,
    ) => Effect.Effect<number, QueueError | BocArchiveError>;
  }
>() {
  static readonly Live = Layer.effect(
    SeederDaemon,
    Effect.gen(function* () {
      const seederWorkflow = yield* SeederWorkflow;

      const runOnce = Effect.fn(function* (options: { startYear: number; endYear: number }) {
        yield* seederWorkflow.runSeeder(options);
      });

      const runScheduled = Effect.fn(function* (
        options: { startYear: number; endYear: number },
        schedule: Schedule.Schedule<number, unknown>,
      ) {
        return yield* Effect.repeat(runOnce(options), schedule);
      });

      return { runOnce, runScheduled };
    }),
  );
}
