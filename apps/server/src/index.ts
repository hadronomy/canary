import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  LogLevel,
  Match,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";

import { DatabaseService } from "@canary/db/effect";
import {
  BoeLawsCollectorFactory,
  countDocumentsForSource,
  ensureBoeCollector,
  ensureBoeSource,
} from "~/collectors/boe";
import { AppLoggerLive } from "~/logging/logger";
import {
  CollectionMode,
  collector,
  CollectorEventBus,
  CollectorLiveWithFactories,
} from "~/services/collector";
import type { CollectionRunId, CollectorId } from "~/services/collector/schema";
import { AxiomTelemetryLive, OtlpInfraLive } from "~/telemetry/axiom";
import { AxiomErrorReporter } from "~/telemetry/errors";

const defaultCollectorCron = "*/15 * * * *";
const bootstrapFactory = BoeLawsCollectorFactory;

const CliOperation = Schema.Literal(
  "startup.dbPrecheck",
  "waitForRunCompletion.fetchSyncRun",
  "waitForRunCompletion.missingSyncRun",
  "waitForRunCompletion.unsuccessful",
  "waitForRunCompletion.cancelled",
  "waitForRunCompletion.stallDetected",
  "startup.ensureBoeSource",
  "startup.ensureBoeCollector",
  "startup.countDocuments",
  "collector.update",
  "collector.runWithMode",
  "collector.schedule",
  "shutdown.cancelRun",
  "shutdown.stopSchedule",
  "shutdown.stopAllSchedules",
);

class CliError extends Schema.TaggedError<CliError>()("CliError", {
  message: Schema.String,
  operation: CliOperation,
  cause: Schema.optional(Schema.Unknown),
}) {}

interface SyncStats {
  inserted: number;
  updated: number;
  failed: number;
  durationMs: number;
}

type FullSyncOutcome = Data.TaggedEnum<{
  readonly Completed: { readonly stats: SyncStats };
  readonly Terminated: { readonly signal: NodeJS.Signals };
}>;

const FullSyncOutcome = Data.taggedEnum<FullSyncOutcome>();

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
  const eventBus = yield* CollectorEventBus;

  const progressLogger = yield* eventBus
    .subscribeToRun(runId, { bufferSize: 50, throttle: "1 second" })
    .pipe(
      Effect.map((stream) =>
        stream.pipe(
          Stream.filter((e) => e._tag === "Progress"),
          Stream.tap((event) =>
            Effect.logInfo("Collector full sync progress", {
              runId,
              processed: event.progress.processed,
              inserted: event.progress.inserted,
              updated: event.progress.updated,
              skipped: event.progress.skipped,
              failed: event.progress.failed,
            }),
          ),
          Stream.runDrain,
        ),
      ),
      Effect.fork,
    );

  const result = yield* eventBus
    .waitForRunCompletionWithStallDetection(runId, Duration.minutes(30))
    .pipe(
      Effect.tap(() => Fiber.interrupt(progressLogger)),
      Effect.map((event) => ({
        inserted: event.stats.inserted,
        updated: event.stats.updated,
        failed: event.stats.failed,
        durationMs: Number(Duration.toMillis(event.stats.duration)),
      })),
      Effect.catchTags({
        Failed: (error) =>
          Effect.fail(
            new CliError({
              operation: "waitForRunCompletion.unsuccessful",
              message: `Collection failed: ${error.error}`,
            }),
          ),
        Cancelled: (error) =>
          Effect.fail(
            new CliError({
              operation: "waitForRunCompletion.cancelled",
              message: `Collection cancelled: ${error.reason || "No reason provided"}`,
            }),
          ),
        CollectionStallError: (error) =>
          Effect.fail(
            new CliError({
              operation: "waitForRunCompletion.stallDetected",
              message: error.message,
            }),
          ),
      }),
    );

  return result;
});

const runCollectorCli = Effect.fn("cli.runCollector")(function* () {
  const activeCollectorRef = yield* Ref.make(Option.none<CollectorId>());
  const activeRunRef = yield* Ref.make(Option.none<CollectionRunId>());

  const gracefulShutdown = Effect.fn("cli.gracefulShutdown")(function* (signal: NodeJS.Signals) {
    yield* Effect.logInfo("Termination signal received", { signal });

    const activeRun = yield* Ref.get(activeRunRef);
    yield* Option.match(activeRun, {
      onNone: () => Effect.void,
      onSome: (runId) => collector.cancelRun(runId, `Received ${signal}`).pipe(Effect.ignore),
    });

    const activeCollector = yield* Ref.get(activeCollectorRef);
    yield* Option.match(activeCollector, {
      onNone: () => Effect.void,
      onSome: (collectorId) => collector.stopSchedule(collectorId).pipe(Effect.ignore),
    });

    yield* collector.stopAllSchedules().pipe(Effect.ignore);
    yield* Effect.logInfo("Graceful shutdown complete", { signal });
  });

  yield* Effect.logInfo("Collector bootstrap started", {
    factoryId: bootstrapFactory.id,
    schedule: defaultCollectorCron,
  });

  yield* DatabaseService.ready().pipe(
    Effect.mapError(
      (cause) =>
        new CliError({
          operation: "startup.dbPrecheck",
          message: cause.message,
          cause,
        }),
    ),
  );

  const sourceId = yield* ensureBoeSource();
  const existingDocuments = yield* countDocumentsForSource(sourceId);
  if (existingDocuments > 0) {
    yield* Effect.logInfo("Existing source documents found; unchanged items will be skipped", {
      factoryId: bootstrapFactory.id,
      sourceId,
      existingDocuments,
    });
  }

  const collectorId = yield* ensureBoeCollector({
    schedule: defaultCollectorCron,
  });
  yield* Ref.set(activeCollectorRef, Option.some(collectorId));

  yield* Effect.logInfo("Collector is ready", {
    factoryId: bootstrapFactory.id,
    collectorId,
  });

  yield* collector.update({
    id: collectorId,
    schedule: defaultCollectorCron,
    mode: CollectionMode.Incremental({
      since: new Date(),
      lookBackWindow: undefined,
    }),
    config: {
      sourceId,
      requestDelay: Duration.millis(50),
      perPageConcurrency: 16,
      textFetchMaxAttempts: 3,
      textRetryBase: Duration.millis(250),
    },
  });

  yield* Effect.logInfo("Starting collector full sync", {
    factoryId: bootstrapFactory.id,
    collectorId,
  });

  const state = yield* collector.estimateState(collectorId);
  const startDate = Option.getOrUndefined(state.lastDocumentDate);

  if (startDate) {
    yield* Effect.logInfo("Found existing documents, using latest date as start", {
      factoryId: bootstrapFactory.id,
      collectorId,
      startDate: startDate.toISOString(),
    });
  }

  const runId = yield* collector.runWithMode(
    collectorId,
    CollectionMode.FullSync({
      startDate,
      batchSize: undefined,
    }),
  );
  yield* Ref.set(activeRunRef, Option.some(runId));

  const fullSyncOutcome = yield* Effect.raceFirst(
    waitForRunCompletion(runId).pipe(Effect.map((stats) => FullSyncOutcome.Completed({ stats }))),
    waitForTerminationSignal.pipe(Effect.map((signal) => FullSyncOutcome.Terminated({ signal }))),
  );

  yield* Match.value(fullSyncOutcome).pipe(
    Match.tag("Terminated", ({ signal }) => gracefulShutdown(signal)),
    Match.tag("Completed", ({ stats }) =>
      Effect.gen(function* () {
        yield* Ref.set(activeRunRef, Option.none());

        yield* Effect.logInfo("Collector full sync finished", {
          factoryId: bootstrapFactory.id,
          collectorId,
          runId,
          inserted: stats.inserted,
          updated: stats.updated,
          failed: stats.failed,
          durationMs: stats.durationMs,
        });

        yield* collector.schedule(collectorId, defaultCollectorCron, {
          startMode: "next_cron",
        });
        yield* Effect.logInfo("Collector incremental schedule started", {
          factoryId: bootstrapFactory.id,
          collectorId,
          cron: defaultCollectorCron,
        });

        const signal = yield* waitForTerminationSignal;
        yield* gracefulShutdown(signal);
      }),
    ),
    Match.exhaustive,
  );
});

const DatabaseLive = DatabaseService.Default;

const CollectorRuntimeLive = Layer.mergeAll(
  CollectorLiveWithFactories(bootstrapFactory),
  CollectorEventBus.Default,
).pipe(Layer.provide(DatabaseLive), Layer.provide(AxiomTelemetryLive));

const AllLayers = Layer.provide(
  Layer.mergeAll(
    DatabaseLive,
    CollectorRuntimeLive,
    AxiomTelemetryLive,
    AxiomErrorReporter.Default,
    Logger.minimumLogLevel(LogLevel.Debug),
  ),
  Layer.merge(AppLoggerLive, OtlpInfraLive),
);

const ErrorHandlerLive = Layer.mergeAll(AxiomErrorReporter.Default, AppLoggerLive);

const reportRuntimeFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    yield* Effect.logError("Runtime failure occurred", cause);

    yield* AxiomErrorReporter.report(Cause.squash(cause)).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.ignore,
    );

    return yield* Effect.failCause(cause);
  }).pipe(Effect.provide(ErrorHandlerLive), Effect.withLogSpan("shutdown"));

const main = runCollectorCli().pipe(
  Effect.provide(AllLayers),
  Effect.catchTags({
    DatabaseUnavailableError: (error) => reportRuntimeFailure(Cause.fail(error)),
    CliError: (error) => reportRuntimeFailure(Cause.fail(error)),
  }),
  Effect.catchAllDefect((defect) =>
    Effect.gen(function* () {
      yield* Effect.logError("Fatal defect occurred", { defect });
      return yield* Effect.die(defect);
    }),
  ),
  Effect.withLogSpan("runtime"),
);

void Effect.runPromiseExit(main).then((exit) => {
  if (Exit.isFailure(exit)) {
    process.exit(1);
  }
  process.exitCode = 0;
});
