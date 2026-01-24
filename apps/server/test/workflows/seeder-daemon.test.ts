import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Schedule } from "effect";
import { SeederWorkflow } from "~/workflows/seeder";
import { SeederDaemon } from "~/workflows/seeder-daemon";

describe("SeederDaemon", () => {
  it("runs the seeder on schedule", async () => {
    const runCountRef = await Effect.runPromise(Ref.make(0));

    const SeederWorkflowTest = Layer.succeed(
      SeederWorkflow,
      SeederWorkflow.of({
        runSeeder: Effect.fn(function* (_options) {
          yield* Ref.update(runCountRef, (count) => count + 1);
        }),
      }),
    );

    const TestLayer = SeederDaemon.Live.pipe(Layer.provide(SeederWorkflowTest));

    const program = Effect.gen(function* () {
      const daemon = yield* SeederDaemon;
      yield* daemon.runScheduled({ startYear: 2020, endYear: 2021 }, Schedule.recurs(1));

      const count = yield* Ref.get(runCountRef);
      expect(count).toBe(2);
    });

    await Effect.runPromise(Effect.provide(program, TestLayer));
  });
});
