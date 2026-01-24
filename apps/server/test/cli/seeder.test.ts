import { describe, expect, it } from "bun:test";

import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, Ref } from "effect";

import { runSeederCli } from "~/cli/seeder";
import { SeederDaemon } from "~/workflows/seeder-daemon";

describe("Seeder CLI", () => {
  it("runs seeder in run mode", async () => {
    const optionsRef = await Effect.runPromise(
      Ref.make<{ startYear: number; endYear: number } | null>(null),
    );

    const SeederDaemonTest = Layer.succeed(
      SeederDaemon,
      SeederDaemon.of({
        runOnce: (options: { startYear: number; endYear: number }) => Ref.set(optionsRef, options),
        runScheduled: (_options: { startYear: number; endYear: number }, _schedule) => Effect.void,
      }),
    );

    const program = runSeederCli([
      "bun",
      "seeder",
      "run",
      "--startYear",
      "1983",
      "--endYear",
      "2024",
    ]).pipe(Effect.provide(Layer.merge(SeederDaemonTest, BunContext.layer)));

    await Effect.runPromise(program);

    const options = await Effect.runPromise(Ref.get(optionsRef));
    expect(options).toEqual({ startYear: 1983, endYear: 2024 });
  });
});
