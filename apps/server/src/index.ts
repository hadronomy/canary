import { Duration, Effect, Fiber, Option, Ref, Schema } from "effect";

import { db, eq } from "@canary/db";
import { syncRuns } from "@canary/db/schema/legislation";
import {
  BoeLawsCollectorFactory,
  countDocumentsForSource,
  ensureBoeCollector,
  ensureBoeSource,
} from "~/collectors/boe";
import { CollectionMode, collector, CollectorLive } from "~/services/collector";
import type { CollectionRunId, CollectorId } from "~/services/collector/schema";

const incrementalCron = "*/15 * * * *";
const progressPollMs = 5000;

class CliError extends Schema.TaggedError<CliError>()("CliError", {
  message: Schema.String,
  operation: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const waitForTerminationSignal = Effect.async<NodeJS.Signals>((resume) => {
  const handleSigInt = () => resume(Effect.succeed("SIGINT"));
  const handleSigTerm = () => resume(Effect.succeed("SIGTERM"));

  process.once("SIGINT", handleSigInt);
  process.once("SIGTERM", handleSigTerm);

  return Effect.sync(() => {
    process.off("SIGINT", handleSigInt);
    process.off("SIGTERM", handleSigTerm);
  });
});

const waitForRunCompletion = Effect.fn("cli.waitForRunCompletion")(function* (
  runId: CollectionRunId,
) {
  let lastLoggedProcessed = -1;

  while (true) {
    const snapshotOption = yield* collector.runSnapshot(runId);
    if (Option.isNone(snapshotOption)) {
      const runRows = yield* Effect.tryPromise({
        try: () =>
          db
            .select({
              status: syncRuns.status,
              docsInserted: syncRuns.docsInserted,
              docsUpdated: syncRuns.docsUpdated,
              docsFailed: syncRuns.docsFailed,
              durationMs: syncRuns.durationMs,
            })
            .from(syncRuns)
            .where(eq(syncRuns.runId, runId))
            .limit(1),
        catch: (cause) =>
          new CliError({
            operation: "waitForRunCompletion.fetchSyncRun",
            message: `Failed to fetch sync run status: ${String(cause)}`,
            cause,
          }),
      });

      const run = runRows[0];
      if (run === undefined) {
        return yield* new CliError({
          operation: "waitForRunCompletion.missingSyncRun",
          message: `Run '${runId}' finished but no sync_runs row was found`,
        });
      }

      if (run.status !== "completed") {
        return yield* new CliError({
          operation: "waitForRunCompletion.unsuccessful",
          message: `Run '${runId}' did not complete successfully (status=${run.status})`,
        });
      }

      return {
        inserted: run.docsInserted,
        updated: run.docsUpdated,
        failed: run.docsFailed,
        durationMs: run.durationMs,
      };
    }

    const snapshot = snapshotOption.value;
    const progressOption = snapshot.progress;
    if (Option.isSome(progressOption)) {
      const progress = progressOption.value;
      if (progress.processed !== lastLoggedProcessed) {
        lastLoggedProcessed = progress.processed;
        yield* Effect.logInfo("BOE full sync progress", {
          runId,
          processed: progress.processed,
          inserted: progress.inserted,
          updated: progress.updated,
          skipped: progress.skipped,
          failed: progress.failed,
        });
      }
    }

    yield* Effect.sleep(Duration.millis(progressPollMs));
  }
});

const runBoeCollectorCli = Effect.fn("cli.runBoeCollector")(function* () {
  yield* collector.registerFactory(BoeLawsCollectorFactory);

  const activeCollectorRef = yield* Ref.make(Option.none<CollectorId>());
  const activeRunRef = yield* Ref.make(Option.none<CollectionRunId>());

  const gracefulShutdown = Effect.fn("cli.gracefulShutdown")(function* (signal: NodeJS.Signals) {
    yield* Effect.logInfo("Termination signal received", { signal });

    const activeRun = yield* Ref.get(activeRunRef);
    if (Option.isSome(activeRun)) {
      yield* collector.cancelRun(activeRun.value, `Received ${signal}`).pipe(Effect.ignore);
    }

    const activeCollector = yield* Ref.get(activeCollectorRef);
    if (Option.isSome(activeCollector)) {
      yield* collector.stopSchedule(activeCollector.value).pipe(Effect.ignore);
    }

    yield* collector.stopAllSchedules().pipe(Effect.ignore);
    yield* Effect.logInfo("Graceful shutdown complete", { signal });
  });

  yield* Effect.logInfo("BOE collector bootstrap started", {
    schedule: incrementalCron,
  });

  const sourceId = yield* ensureBoeSource();
  const existingDocuments = yield* countDocumentsForSource(sourceId);
  if (existingDocuments > 0) {
    yield* Effect.logInfo("Existing BOE documents found; unchanged items will be skipped", {
      sourceId,
      existingDocuments,
    });
  }

  const collectorId = yield* ensureBoeCollector({
    schedule: incrementalCron,
  });
  yield* Ref.set(activeCollectorRef, Option.some(collectorId));

  yield* Effect.logInfo("BOE collector is ready", {
    collectorId,
  });

  yield* collector.update({
    id: collectorId,
    schedule: incrementalCron,
    mode: CollectionMode.Incremental({
      since: new Date(),
      lookBackWindow: undefined,
    }),
    config: {
      sourceId,
      requestDelayMs: 50,
      perPageConcurrency: 16,
      textFetchMaxAttempts: 3,
      textRetryBaseMs: 250,
    },
  });

  yield* Effect.logInfo("Starting BOE full sync", {
    collectorId,
  });

  const runId = yield* collector.runWithMode(
    collectorId,
    CollectionMode.FullSync({
      startDate: undefined,
      batchSize: undefined,
    }),
  );
  yield* Ref.set(activeRunRef, Option.some(runId));

  const fullSyncOutcome = yield* Effect.raceFirst(
    waitForRunCompletion(runId).pipe(
      Effect.map((stats) => ({ _tag: "Completed" as const, stats })),
    ),
    waitForTerminationSignal.pipe(
      Effect.map((signal) => ({ _tag: "Terminated" as const, signal })),
    ),
  );

  if (fullSyncOutcome._tag === "Terminated") {
    yield* gracefulShutdown(fullSyncOutcome.signal);
    return;
  }

  const stats = fullSyncOutcome.stats;
  yield* Ref.set(activeRunRef, Option.none());

  yield* Effect.logInfo("BOE full sync finished", {
    collectorId,
    runId,
    inserted: stats.inserted,
    updated: stats.updated,
    failed: stats.failed,
    durationMs: stats.durationMs,
  });

  yield* collector.schedule(collectorId, incrementalCron);
  yield* Effect.logInfo("BOE incremental schedule started", {
    collectorId,
    cron: incrementalCron,
  });

  const heartbeat = Effect.forever(
    Effect.sleep(Duration.minutes(15)).pipe(
      Effect.zipRight(
        Effect.logInfo("BOE scheduler heartbeat", {
          collectorId,
          cron: incrementalCron,
        }),
      ),
    ),
  );

  const heartbeatFiber = yield* Effect.forkDaemon(heartbeat);
  const signal = yield* waitForTerminationSignal;
  yield* gracefulShutdown(signal).pipe(Effect.ensuring(Fiber.interrupt(heartbeatFiber)));
  return;
});

const main = runBoeCollectorCli().pipe(Effect.provide(CollectorLive));
void Effect.runPromise(main);

// import { cors } from "@elysiajs/cors";
// import { Elysia } from "elysia";
// import { env } from "@canary/env/server";
//
// // @ts-ignore 6133
// // oxlint-disable-next-line no-unused-vars
// const app = new Elysia()
//   .use(
//     cors({
//       origin: env.CORS_ORIGIN,
//       methods: ["GET", "POST", "OPTIONS"],
//     }),
//   )
//   .get("/", () => "OK")
//   .listen(3000, () => {
//     console.log("Server is running on http://localhost:3000");
//   });
