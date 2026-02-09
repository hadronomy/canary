import { Duration, Effect, Schema } from "effect";

import { databaseServiceConfig } from "./config";
import { db } from "./index";
import { legislativeSources } from "./schema/legislation";

export class DatabaseUnavailableError extends Schema.TaggedError<DatabaseUnavailableError>()(
  "DatabaseUnavailableError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class DatabaseService extends Effect.Service<DatabaseService>()("DatabaseService", {
  accessors: true,
  scoped: Effect.gen(function* () {
    const config = yield* databaseServiceConfig;

    const healthCheck = Effect.fn("DatabaseService.healthCheck")(function* () {
      yield* Effect.tryPromise({
        try: () =>
          db.select({ sourceId: legislativeSources.sourceId }).from(legislativeSources).limit(1),
        catch: (cause) =>
          new DatabaseUnavailableError({
            operation: "healthCheck",
            message: `Database health check failed: ${String(cause)}`,
            cause,
          }),
      }).pipe(Effect.asVoid);
    });

    const startupCheck = (attempt: number): Effect.Effect<void, DatabaseUnavailableError> =>
      healthCheck().pipe(
        Effect.catchTag("DatabaseUnavailableError", (error) => {
          if (attempt >= config.startupRetries) {
            return Effect.fail(error);
          }

          const delayMs = Math.max(0, config.startupBaseDelayMs * 2 ** attempt);
          return Effect.logWarning("Database unavailable during startup precheck, retrying", {
            attempt: attempt + 1,
            maxRetries: config.startupRetries,
            nextDelayMs: delayMs,
            error: error.message,
          }).pipe(
            Effect.zipRight(Effect.sleep(Duration.millis(delayMs))),
            Effect.zipRight(startupCheck(attempt + 1)),
          );
        }),
      );

    const ready = Effect.fn("DatabaseService.ready")(function* () {
      yield* startupCheck(0);
    });

    const client = Effect.fn("DatabaseService.client")(function* () {
      return db;
    });

    return {
      ready,
      healthCheck,
      client,
    };
  }),
}) {}
