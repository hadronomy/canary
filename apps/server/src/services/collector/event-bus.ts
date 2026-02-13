import { Duration, Effect, Metric, MetricBoundaries, Option, PubSub, Stream } from "effect";

import { CollectionStallError } from "./errors";
import {
  CancelledEvent,
  CompletedEvent,
  FailedEvent,
  isTerminalEvent,
  ProgressEvent,
  type CollectorEvent,
} from "./events";
import type { CollectionRunId } from "./schema";

const publishLatencyBuckets = MetricBoundaries.linear({
  start: 0,
  width: 10,
  count: 20,
});

export interface BackpressureConfig {
  readonly progressBufferSize: number;
  readonly terminalBufferSize: number;
}

export class CollectorEventBus extends Effect.Service<CollectorEventBus>()("CollectorEventBus", {
  accessors: true,
  effect: Effect.gen(function* () {
    const config: BackpressureConfig = {
      progressBufferSize: 50,
      terminalBufferSize: 100,
    };

    const terminalPubSub = yield* PubSub.bounded<CompletedEvent | FailedEvent | CancelledEvent>(
      config.terminalBufferSize,
    );

    const progressPubSub = yield* PubSub.sliding<ProgressEvent>(config.progressBufferSize);

    const eventsPublished = Metric.counter("collector_events_published");
    const eventsDropped = Metric.counter("collector_events_dropped");
    const publishLatency = Metric.histogram(
      "collector_event_publish_latency",
      publishLatencyBuckets,
    );

    const publish = Effect.fn("CollectorEventBus.publish")(function* (event: CollectorEvent) {
      const startTime = yield* Effect.sync(() => Date.now());

      yield* Effect.annotateCurrentSpan("event.runId", event.runId);
      yield* Effect.annotateCurrentSpan("event.collectorId", event.collectorId);
      yield* Effect.annotateCurrentSpan("event.type", event._tag);

      if (event._tag === "Progress") {
        yield* Effect.annotateCurrentSpan("progress.processed", event.progress.processed);
        yield* Effect.annotateCurrentSpan("progress.inserted", event.progress.inserted);
        yield* Effect.annotateCurrentSpan("progress.updated", event.progress.updated);
        yield* Effect.annotateCurrentSpan("progress.skipped", event.progress.skipped);
      }

      const publishEffect =
        event._tag === "Progress" ? progressPubSub.publish(event) : terminalPubSub.publish(event);

      yield* publishEffect.pipe(
        Metric.trackDurationWith(publishLatency, (d) => Duration.toMillis(d)),
        Effect.tap(() => Metric.increment(eventsPublished)),
        Effect.tapError(() => Metric.increment(eventsDropped)),
        Effect.timeout("1 second"),
        Effect.catchAll(() =>
          event._tag === "Progress" ? Effect.void : Effect.die("Failed to publish terminal event"),
        ),
      );

      const logMessage =
        event._tag === "Progress"
          ? "Progress event published"
          : event._tag === "Completed"
            ? "Collection completed event published"
            : event._tag === "Failed"
              ? "Collection failed event published"
              : "Collection cancelled event published";

      yield* Effect.logDebug(logMessage, {
        runId: event.runId,
        durationMs: Date.now() - startTime,
        ...(event._tag === "Progress"
          ? {
              processed: event.progress.processed,
              inserted: event.progress.inserted,
              updated: event.progress.updated,
            }
          : event._tag === "Completed"
            ? {
                totalProcessed: event.stats.processed,
                totalInserted: event.stats.inserted,
                totalUpdated: event.stats.updated,
              }
            : event._tag === "Failed"
              ? { error: event.error, retryable: event.retryable }
              : { reason: event.reason }),
      });
    });

    const subscribeToRun = Effect.fn("CollectorEventBus.subscribeToRun")(function* (
      runId: CollectionRunId,
      options?: {
        bufferSize?: number;
        throttle?: Duration.DurationInput;
      },
    ) {
      yield* Effect.annotateCurrentSpan("subscription.runId", runId);
      yield* Effect.annotateCurrentSpan("subscription.bufferSize", options?.bufferSize ?? 100);
      yield* Effect.annotateCurrentSpan(
        "subscription.throttleMs",
        Duration.toMillis(options?.throttle ?? "0 millis"),
      );

      const bufferSize = options?.bufferSize ?? 100;
      const throttleDuration = options?.throttle ?? "0 millis";

      yield* Effect.logInfo("Subscribing to run events", { runId, bufferSize });

      const merged = Stream.merge(
        Stream.fromPubSub(progressPubSub),
        Stream.fromPubSub(terminalPubSub),
        { haltStrategy: "left" },
      );

      return merged.pipe(
        Stream.filter((event) => event.runId === runId),
        Stream.buffer({ capacity: bufferSize }),
        Stream.throttle({
          cost: () => 1,
          duration: throttleDuration,
          units: 10,
        }),
        Stream.tap((event) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan("received.eventType", event._tag);
            yield* Effect.annotateCurrentSpan("received.runId", runId);

            if (event._tag === "Progress") {
              yield* Effect.annotateCurrentSpan("received.processed", event.progress.processed);
            }

            const logMessage =
              event._tag === "Progress"
                ? "Progress event received"
                : event._tag === "Completed"
                  ? "Collection completed event received"
                  : event._tag === "Failed"
                    ? "Collection failed event received"
                    : "Collection cancelled event received";

            yield* Effect.logDebug(logMessage, {
              runId,
              ...(event._tag === "Progress"
                ? {
                    processed: event.progress.processed,
                    inserted: event.progress.inserted,
                    updated: event.progress.updated,
                    skipped: event.progress.skipped,
                    failed: event.progress.failed,
                  }
                : event._tag === "Completed"
                  ? {
                      totalProcessed: event.stats.processed,
                      totalInserted: event.stats.inserted,
                      totalUpdated: event.stats.updated,
                    }
                  : event._tag === "Failed"
                    ? { error: event.error, retryable: event.retryable }
                    : { reason: event.reason }),
            });
          }),
        ),
        Stream.ensuring(
          Effect.gen(function* () {
            yield* Effect.logInfo("Unsubscribed from run", { runId });
            yield* Effect.annotateCurrentSpan("subscription.status", "terminated");
          }),
        ),
      );
    });

    const subscribe = Effect.fn("CollectorEventBus.subscribe")(function* (options?: {
      bufferSize?: number;
    }) {
      const bufferSize = options?.bufferSize ?? 100;
      yield* Effect.annotateCurrentSpan("subscription.bufferSize", bufferSize);
      yield* Effect.annotateCurrentSpan("subscription.scope", "global");

      return Stream.merge(Stream.fromPubSub(progressPubSub), Stream.fromPubSub(terminalPubSub), {
        haltStrategy: "left",
      }).pipe(
        Stream.buffer({ capacity: bufferSize }),
        Stream.tap((event) => Effect.annotateCurrentSpan("received.eventType", event._tag)),
        Stream.ensuring(
          Effect.gen(function* () {
            yield* Effect.logInfo("Unsubscribed from all events");
            yield* Effect.annotateCurrentSpan("subscription.status", "terminated");
          }),
        ),
      );
    });

    const waitForRunCompletion = Effect.fn("CollectorEventBus.waitForRunCompletion")(function* (
      runId: CollectionRunId,
    ) {
      yield* Effect.annotateCurrentSpan("wait.runId", runId);
      yield* Effect.logInfo("Waiting for run completion", { runId });

      const stream = yield* subscribeToRun(runId, { bufferSize: 10 });

      return yield* stream.pipe(
        Stream.takeUntil(isTerminalEvent),
        Stream.runLast,
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.gen(function* () {
                yield* Effect.logError("Stream ended without terminal event", { runId });
                yield* Effect.annotateCurrentSpan("completion.status", "error");
                yield* Effect.annotateCurrentSpan("completion.error", "no_terminal_event");
                return yield* Effect.die("Stream ended without terminal event");
              }),
            onSome: (event) =>
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan("completion.status", event._tag);
                yield* Effect.annotateCurrentSpan("completion.runId", runId);

                if (event._tag === "Completed") {
                  yield* Effect.logInfo("Run completed successfully", {
                    runId,
                    stats: event.stats,
                  });
                  return yield* Effect.succeed(event);
                } else if (event._tag === "Failed" || event._tag === "Cancelled") {
                  yield* Effect.logWarning("Run did not complete successfully", {
                    runId,
                    status: event._tag,
                  });
                  return yield* Effect.fail(event);
                }
                return yield* Effect.die("Unexpected progress event");
              }),
          }),
        ),
      );
    });

    const waitForRunCompletionWithStallDetection = Effect.fn(
      "CollectorEventBus.waitForRunCompletionWithStallDetection",
    )(function* (
      runId: CollectionRunId,
      stallTimeout: Duration.DurationInput = Duration.minutes(30),
    ) {
      const stallTimeoutMs = Duration.toMillis(stallTimeout);
      yield* Effect.annotateCurrentSpan("wait.runId", runId);
      yield* Effect.annotateCurrentSpan("wait.stallTimeoutMs", stallTimeoutMs);
      yield* Effect.logInfo("Waiting for run completion with stall detection", {
        runId,
        stallTimeoutMs,
      });

      const stream = yield* subscribeToRun(runId, { bufferSize: 10 });

      return yield* stream.pipe(
        Stream.timeoutFail(
          () =>
            new CollectionStallError({
              runId,
              durationMs: stallTimeoutMs,
              message: `No events received for ${stallTimeoutMs}ms`,
            }),
          stallTimeout,
        ),
        Stream.takeUntil(isTerminalEvent),
        Stream.runLast,
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.gen(function* () {
                yield* Effect.logError("Stream ended without terminal event", { runId });
                yield* Effect.annotateCurrentSpan("completion.status", "error");
                yield* Effect.annotateCurrentSpan("completion.error", "no_terminal_event");
                return yield* Effect.die("Stream ended without terminal event");
              }),
            onSome: (event) =>
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan("completion.status", event._tag);
                yield* Effect.annotateCurrentSpan("completion.runId", runId);

                if (event._tag === "Completed") {
                  yield* Effect.logInfo("Run completed successfully", {
                    runId,
                    stats: event.stats,
                  });
                  return yield* Effect.succeed(event);
                } else if (event._tag === "Failed" || event._tag === "Cancelled") {
                  yield* Effect.logWarning("Run did not complete successfully", {
                    runId,
                    status: event._tag,
                  });
                  return yield* Effect.fail(event);
                }
                return yield* Effect.die("Unexpected progress event");
              }),
          }),
        ),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            yield* Effect.logError("Stall detection triggered or error occurred", {
              runId,
              error: error._tag,
            });
            yield* Effect.annotateCurrentSpan("completion.status", "stall_or_error");
            yield* Effect.annotateCurrentSpan("completion.error", error._tag);
          }),
        ),
      );
    });

    return {
      publish,
      subscribe,
      subscribeToRun,
      waitForRunCompletion,
      waitForRunCompletionWithStallDetection,
    };
  }),
}) {}
