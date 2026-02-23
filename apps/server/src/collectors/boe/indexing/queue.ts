import { PersistedQueue } from "@effect/experimental";
import { SqlPersistedQueue } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Cause, Config, Duration, Effect, Layer, Schema } from "effect";

import { IndexingWorkflowError } from "./errors";
import { IndexingTriggerPayload } from "./schema";
import { BoeIndexingWorkflow } from "./workflow";

export class BoeIndexingQueueError extends Schema.TaggedError<BoeIndexingQueueError>()(
  "BoeIndexingQueueError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export const BoeIndexingQueuePersistenceLayer = Layer.unwrapEffect(
  Config.all({
    sqlitePath: Config.string("BOE_INDEXING_QUEUE_SQLITE_PATH").pipe(
      Config.withDefault("./.canary-indexing-queue.sqlite"),
    ),
    pollMs: Config.integer("BOE_INDEXING_QUEUE_POLL_MS").pipe(Config.withDefault(500)),
    lockRefreshSeconds: Config.integer("BOE_INDEXING_QUEUE_LOCK_REFRESH_SECONDS").pipe(
      Config.withDefault(30),
    ),
    lockExpirationSeconds: Config.integer("BOE_INDEXING_QUEUE_LOCK_EXPIRATION_SECONDS").pipe(
      Config.withDefault(180),
    ),
  }).pipe(
    Effect.orDie,
    Effect.map(({ sqlitePath, pollMs, lockRefreshSeconds, lockExpirationSeconds }) =>
      PersistedQueue.layer.pipe(
        Layer.provide(
          SqlPersistedQueue.layerStore({
            tableName: "boe_indexing_queue",
            pollInterval: Duration.millis(pollMs),
            lockRefreshInterval: Duration.seconds(lockRefreshSeconds),
            lockExpiration: Duration.seconds(lockExpirationSeconds),
          }),
        ),
        Layer.provideMerge(SqliteClient.layer({ filename: sqlitePath })),
      ),
    ),
  ),
);

export class BoeIndexingQueue extends Effect.Service<BoeIndexingQueue>()("BoeIndexingQueue", {
  accessors: true,
  dependencies: [BoeIndexingWorkflow.Default, BoeIndexingQueuePersistenceLayer],
  scoped: Effect.gen(function* () {
    const workerConcurrencyRaw = yield* Config.integer("BOE_INDEXING_QUEUE_CONCURRENCY").pipe(
      Config.withDefault(2),
      Effect.orDie,
    );
    const maxAttemptsRaw = yield* Config.integer("BOE_INDEXING_QUEUE_MAX_ATTEMPTS").pipe(
      Config.withDefault(6),
      Effect.orDie,
    );
    const enqueueConcurrencyRaw = yield* Config.integer(
      "BOE_INDEXING_QUEUE_ENQUEUE_CONCURRENCY",
    ).pipe(Config.withDefault(8), Effect.orDie);

    const queueWorkerConcurrency = Math.min(2, Math.max(1, workerConcurrencyRaw));
    const queueMaxAttempts = Math.max(1, maxAttemptsRaw);
    const enqueueConcurrency = Math.max(1, enqueueConcurrencyRaw);

    const indexingWorkflow = yield* BoeIndexingWorkflow;
    const queue = yield* PersistedQueue.make({
      name: "boe-indexing",
      schema: IndexingTriggerPayload,
    });

    const makeIdempotencyKey = (payload: Schema.Schema.Type<typeof IndexingTriggerPayload>) =>
      `${payload.versionId}:${payload.contentHash ?? "none"}`;

    const summarizeCause = (cause: unknown): string => {
      if (cause instanceof IndexingWorkflowError) {
        const inner = cause.cause === undefined ? "" : `: ${summarizeCause(cause.cause)}`;
        return `${cause._tag}:${cause.stage}:${cause.message}${inner}`;
      }
      if (Cause.isCause(cause)) {
        return Cause.pretty(cause, { renderErrorCause: true });
      }
      if (cause instanceof Error) {
        return `${cause.name}: ${cause.message}`;
      }
      return String(cause);
    };

    const enqueue = Effect.fn("BoeIndexingQueue.enqueue")(
      (payload: Schema.Schema.Type<typeof IndexingTriggerPayload>) =>
        queue.offer(payload, { id: makeIdempotencyKey(payload) }).pipe(
          Effect.mapError(
            (cause) =>
              new BoeIndexingQueueError({
                message: "Unable to enqueue BOE indexing payload",
                cause,
              }),
          ),
        ),
    );

    const enqueueMany = Effect.fn("BoeIndexingQueue.enqueueMany")(
      (payloads: ReadonlyArray<Schema.Schema.Type<typeof IndexingTriggerPayload>>) =>
        Effect.forEach(payloads, enqueue, {
          discard: true,
          concurrency: enqueueConcurrency,
        }),
    );

    const worker = Effect.gen(function* () {
      const maxAttempts = queueMaxAttempts;
      yield* queue
        .take(
          (payload, metadata) =>
            indexingWorkflow.start(payload).pipe(
              Effect.tapError((cause) =>
                Effect.logWarning(
                  "Boe indexing durable queue worker failed; item will be retried",
                  {
                    queue: "boe-indexing",
                    attempt: metadata.attempts + 1,
                    maxAttempts,
                    docId: payload.docId,
                    versionId: payload.versionId,
                    executionKey: makeIdempotencyKey(payload),
                    cause: summarizeCause(cause),
                  },
                ),
              ),
            ),
          { maxAttempts },
        )
        .pipe(Effect.catchTag("IndexingWorkflowError", () => Effect.void));
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logWarning("Boe indexing durable queue take failed", {
          queue: "boe-indexing",
          cause: String(cause),
        }),
      ),
      Effect.forever,
    );

    yield* Effect.forEach(
      Array.from({ length: queueWorkerConcurrency }),
      (_, workerIndex) =>
        Effect.forkScoped(
          worker.pipe(
            Effect.withSpan("BoeIndexingQueue.worker", {
              attributes: { workerIndex },
            }),
          ),
        ),
      { discard: true },
    );

    return {
      enqueue,
      enqueueMany,
    };
  }),
}) {}
