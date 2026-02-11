import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Config, Duration, Effect, Layer, Option, Schedule, Schema } from "effect";
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

export type DatabaseServiceApi = {
  readonly ready: () => Effect.Effect<void, DatabaseUnavailableError>;
  readonly healthCheck: () => Effect.Effect<void, DatabaseUnavailableError>;
  readonly client: () => Effect.Effect<DatabaseClient>;
};

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

const makeDatabaseService = Effect.fn("DatabaseService.make")(function* (
  db: DatabaseClient,
  startupRetries: number,
  startupBaseDelay: Duration.Duration,
) {
  const startupRetrySchedule = Schedule.exponential(
    Duration.max(Duration.millis(1), startupBaseDelay),
  ).pipe(Schedule.compose(Schedule.recurs(startupRetries)));

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
            maxRetries: startupRetries,
            baseDelayMs: Duration.toMillis(startupBaseDelay),
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
});

const make = Effect.gen(function* () {
  const serviceConfig = yield* databaseServiceConfig;

  const db: DatabaseClient = yield* PgDrizzle.make({ schema, relations });

  const service = yield* makeDatabaseService(
    db,
    serviceConfig.startupRetries,
    serviceConfig.startupBaseDelay,
  ).pipe(
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
    Effect.retry(
      Schedule.exponential(Duration.max(Duration.millis(1), serviceConfig.startupBaseDelay)).pipe(
        Schedule.compose(Schedule.recurs(serviceConfig.startupRetries)),
      ),
    ),
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

  return service;
}).pipe(Effect.withSpan("DatabaseService.make"));

const pgClientConfig = Config.all({
  url: databaseClientConfig.pipe(Config.map((c) => Redacted.make(c.databaseUrl))),
  maxConnections: databaseClientConfig.pipe(Config.map((c) => c.poolMax)),
  idleTimeout: databaseClientConfig.pipe(Config.map((c) => Duration.seconds(c.poolIdleTimeout))),
  connectTimeout: databaseClientConfig.pipe(
    Config.map((c) => Duration.seconds(c.poolConnectionTimeout)),
  ),
  ssl: Config.succeed(false),
});

const pgClientLayer = PgClient.layerConfig(pgClientConfig);

const drizzleDependencies = Layer.merge(PgDrizzle.DefaultServices, pgClientLayer);

export class DatabaseService extends Effect.Service<DatabaseService>()("DatabaseService", {
  accessors: true,
  effect: make,
  dependencies: [drizzleDependencies],
}) {}

export type { SqlClient } from "@effect/sql/SqlClient";
export type { SqlError } from "@effect/sql/SqlError";
