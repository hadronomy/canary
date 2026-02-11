import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Duration, Effect, Option, Schedule, Schema } from "effect";
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

  const startupRetrySchedule = Schedule.exponential(
    Duration.max(Duration.millis(1), serviceConfig.startupBaseDelay),
  ).pipe(Schedule.compose(Schedule.recurs(serviceConfig.startupRetries)));

  const withCurrentSpanCorrelation = <A extends Record<string, unknown>>(fields: A) =>
    Effect.gen(function* () {
      const spanOption = yield* Effect.currentSpan.pipe(Effect.option);
      if (Option.isNone(spanOption)) {
        return fields;
      }
      return {
        ...fields,
        traceId: spanOption.value.traceId,
        spanId: spanOption.value.spanId,
      };
    });

  const db: DatabaseClient = yield* PgDrizzle.make({ schema, relations }).pipe(
    Effect.provide(drizzleLayer),
    Effect.tapError((cause) =>
      Effect.gen(function* () {
        const fields = yield* withCurrentSpanCorrelation({
          maxRetries: serviceConfig.startupRetries,
          baseDelayMs: Duration.toMillis(serviceConfig.startupBaseDelay),
          error: String(cause),
        });
        yield* Effect.logWarning("Database client initialization failed", fields);
      }),
    ),
    Effect.retry(startupRetrySchedule),
    Effect.mapError(
      (cause) =>
        new DatabaseUnavailableError({
          operation: "createDatabaseClient",
          message: `Failed to create effect-postgres client: ${String(cause)}`,
          cause,
        }),
    ),
    Effect.withSpan("DatabaseService.initializeClient"),
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

  const ready = Effect.fn("DatabaseService.ready")(() =>
    healthCheck().pipe(
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const fields = yield* withCurrentSpanCorrelation({
            maxRetries: serviceConfig.startupRetries,
            baseDelayMs: Duration.toMillis(serviceConfig.startupBaseDelay),
            error: error.message,
          });
          yield* Effect.logWarning("Database unavailable during startup precheck", fields);
        }),
      ),
      Effect.retry(startupRetrySchedule),
    ),
  );
  const client = Effect.fn("DatabaseService.client")(() => Effect.succeed(db));

  const service: DatabaseServiceApi = {
    ready,
    healthCheck,
    client,
  };

  return service;
}).pipe(Effect.withSpan("DatabaseService.make"));

export class DatabaseService extends Effect.Service<DatabaseService>()("DatabaseService", {
  accessors: true,
  scoped: makeDatabaseService,
}) {}
