import { Command, Options } from "@effect/cli";
import type { CliApp } from "@effect/cli/CliApp";
import type { ValidationError } from "@effect/cli/ValidationError";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { QueueError, QueueServiceLive } from "../services/queue.js";
import { SeederDaemon } from "../workflows/seeder-daemon.js";
import { BocArchiveError, BocArchiveService, SeederWorkflow } from "../workflows/seeder.js";

const startYear = Options.integer("startYear").pipe(
  Options.withDescription("First year to seed from the archive"),
);

const endYear = Options.integer("endYear").pipe(
  Options.withDescription("Last year to seed from the archive"),
);

const runHandler = ({
  startYear,
  endYear,
}: {
  startYear: number;
  endYear: number;
}): Effect.Effect<void, QueueError | BocArchiveError, SeederDaemon> =>
  Effect.gen(function* () {
    const daemon = yield* SeederDaemon;
    yield* daemon.runOnce({ startYear, endYear });
  });

const runCommand = Command.make("run", { startYear, endYear }, runHandler).pipe(
  Command.withDescription("Run the seeder once"),
);

const daemonHandler = ({
  startYear,
  endYear,
}: {
  startYear: number;
  endYear: number;
}): Effect.Effect<void, QueueError | BocArchiveError, SeederDaemon> =>
  Effect.gen(function* () {
    const daemon = yield* SeederDaemon;
    yield* daemon.runScheduled({ startYear, endYear }, Schedule.fixed("15 minutes"));
  }).pipe(Effect.asVoid);

const daemonCommand = Command.make("daemon", { startYear, endYear }, daemonHandler).pipe(
  Command.withDescription("Run the seeder on a schedule"),
);

const seederCommand = Command.make("seeder", {}).pipe(
  Command.withDescription("Seed the BOC archive into queues"),
  Command.withSubcommands([runCommand, daemonCommand]),
);

const cli = Command.run(seederCommand, {
  name: "seeder",
  version: "1.0.0",
});

const SeederWorkflowLiveLayer = SeederWorkflow.Live.pipe(
  Layer.provide(Layer.mergeAll(BocArchiveService.Live, QueueServiceLive)),
);

export const SeederCliLiveLayer = SeederDaemon.Live.pipe(Layer.provide(SeederWorkflowLiveLayer));

export const runSeederCli = (
  argv: ReadonlyArray<string>,
): Effect.Effect<
  void,
  ValidationError | BocArchiveError | QueueError,
  SeederDaemon | CliApp.Environment
> => cli(argv);
