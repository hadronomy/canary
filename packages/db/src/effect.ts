import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Duration, Effect, Schema } from "effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { databaseClientConfig, databaseServiceConfig } from "./config";
import * as schema from "./schema";
import { relations } from "./schema/relations";

export type DatabaseClient = PgDrizzle.EffectPgDatabase<typeof schema, typeof relations>;

export class DatabaseUnavailableError extends Schema.TaggedError<DatabaseUnavailableError>()(
  "DatabaseUnavailableError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

interface DatabaseServiceApi {
  readonly ready: () => Effect.Effect<void, DatabaseUnavailableError>;
  readonly healthCheck: () => Effect.Effect<void, DatabaseUnavailableError>;
  readonly client: () => Effect.Effect<DatabaseClient>;
}

const makeDatabaseService = Effect.gen(function* () {
  const clientConfig = yield* databaseClientConfig.pipe(
    Effect.mapError(
      (cause) =>
        new DatabaseUnavailableError({
          operation: "loadDatabaseClientConfig",
          message: `Failed to load database client config: ${String(cause)}`,
          cause,
        }),
    ),
  );
  const serviceConfig = yield* databaseServiceConfig.pipe(
    Effect.mapError(
      (cause) =>
        new DatabaseUnavailableError({
          operation: "loadDatabaseServiceConfig",
          message: `Failed to load database service config: ${String(cause)}`,
          cause,
        }),
    ),
  );

  const pgClientLayer = PgClient.layer({
    url: Redacted.make(clientConfig.databaseUrl),
    maxConnections: clientConfig.poolMax,
    idleTimeout: Duration.seconds(clientConfig.poolIdleTimeout),
    connectTimeout: Duration.seconds(clientConfig.poolConnectionTimeout),
  });

  const drizzleLayer = Layer.merge(PgDrizzle.DefaultServices, pgClientLayer);

  const db: DatabaseClient = yield* PgDrizzle.make({ schema, relations }).pipe(
    Effect.provide(drizzleLayer),
    Effect.mapError(
      (cause) =>
        new DatabaseUnavailableError({
          operation: "createDatabaseClient",
          message: `Failed to create effect-postgres client: ${String(cause)}`,
          cause,
        }),
    ),
  );

  const healthCheck = Effect.fn("DatabaseService.healthCheck")(() =>
    db.execute("select 1").pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new DatabaseUnavailableError({
            operation: "healthCheck",
            message: `Database health check failed: ${String(cause)}`,
            cause,
          }),
      ),
    ),
  );

  const startupCheck = (attempt: number): Effect.Effect<void, DatabaseUnavailableError> =>
    healthCheck().pipe(
      Effect.catchTag("DatabaseUnavailableError", (error) => {
        if (attempt >= serviceConfig.startupRetries) {
          return Effect.fail(error);
        }

        const delayMs = Math.max(0, serviceConfig.startupBaseDelayMs * 2 ** attempt);
        return Effect.logWarning("Database unavailable during startup precheck, retrying", {
          attempt: attempt + 1,
          maxRetries: serviceConfig.startupRetries,
          nextDelayMs: delayMs,
          error: error.message,
        }).pipe(
          Effect.zipRight(Effect.sleep(Duration.millis(delayMs))),
          Effect.zipRight(startupCheck(attempt + 1)),
        );
      }),
    );

  const ready = Effect.fn("DatabaseService.ready")(() => startupCheck(0));
  const client = Effect.fn("DatabaseService.client")(() => Effect.succeed(db));

  const service: DatabaseServiceApi = {
    ready,
    healthCheck,
    client,
  };

  return service;
});

export class DatabaseService extends Effect.Service<DatabaseService>()("DatabaseService", {
  accessors: true,
  scoped: makeDatabaseService,
}) {}
