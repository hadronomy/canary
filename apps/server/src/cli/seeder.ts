import { Command, Options } from "@effect/cli";
import type { CliApp } from "@effect/cli/CliApp";
import type { ValidationError } from "@effect/cli/ValidationError";
import type { FileSystem } from "@effect/platform/FileSystem";
import type { Path } from "@effect/platform/Path";
import type { Terminal } from "@effect/platform/Terminal";
import { Effect, Layer, Schedule } from "effect";

import { QueueError, QueueServiceLive } from "~/services/queue";
import { BocArchiveError, BocArchiveService, SeederWorkflow } from "~/workflows/seeder";
import { SeederDaemon } from "~/workflows/seeder-daemon";

const startYear = Options.integer("startYear").pipe(
  Options.withDescription("First year to seed from the archive"),
);

const endYear = Options.integer("endYear").pipe(
  Options.withDescription("Last year to seed from the archive"),
);

const runHandler = Effect.fn("SeederCli.run")(function* ({
  startYear,
  endYear,
}: {
  readonly startYear: number;
  readonly endYear: number;
}) {
  const daemon = yield* SeederDaemon;
  yield* daemon.runOnce({ startYear, endYear });
});

const runCommand = Command.make("run", { startYear, endYear }, runHandler).pipe(
  Command.withDescription("Run the seeder once"),
);

const daemonHandler = Effect.fn("SeederCli.daemon")(function* ({
  startYear,
  endYear,
}: {
  readonly startYear: number;
  readonly endYear: number;
}) {
  const daemon = yield* SeederDaemon;
  yield* daemon.runScheduled({ startYear, endYear }, Schedule.fixed("15 minutes"));
});

const daemonCommand = Command.make("daemon", { startYear, endYear }, daemonHandler).pipe(
  Command.withDescription("Run the seeder on a schedule"),
);

const seederCommand = Command.make("seeder", {}, () => Effect.void).pipe(
  Command.withDescription("Seeder CLI"),
  Command.withSubcommands([runCommand, daemonCommand]),
);

const cli = Command.run(seederCommand, {
  name: "Seeder CLI",
  version: "1.0.0",
});

const SeederWorkflowLiveLayer = SeederWorkflow.Live.pipe(
  Layer.provide(Layer.mergeAll(BocArchiveService.Live, QueueServiceLive)),
);

export const SeederCliLiveLayer = SeederDaemon.Live.pipe(Layer.provide(SeederWorkflowLiveLayer));

export type SeederEnvironment = SeederDaemon | FileSystem | Path | Terminal;

export const runSeederCli = (
  argv: ReadonlyArray<string>,
): Effect.Effect<
  void,
  ValidationError | BocArchiveError | QueueError,
  SeederDaemon | CliApp.Environment
> => cli(argv) as any;
