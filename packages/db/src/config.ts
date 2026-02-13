import { Config, Duration, Effect, Schema } from "effect";

const PositiveIntFromString = Schema.NumberFromString.pipe(Schema.int(), Schema.greaterThan(0));
const NonNegativeIntFromString = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const databaseClientConfig = Config.all({
  databaseUrl: Schema.Config("DATABASE_URL", NonEmptyString),
  captureQueryText: Config.boolean("DB_OTEL_CAPTURE_QUERY_TEXT").pipe(Config.withDefault(false)),
  poolMax: Schema.Config("DB_POOL_MAX", PositiveIntFromString).pipe(Config.withDefault(10)),
  poolIdleTimeout: Config.duration("DB_POOL_IDLE_TIMEOUT").pipe(
    Config.withDefault(Duration.seconds(30)),
  ),
  poolConnectionTimeout: Config.duration("DB_POOL_CONNECTION_TIMEOUT").pipe(
    Config.withDefault(Duration.seconds(30)),
  ),
});

export const databaseServiceConfig = Config.all({
  startupRetries: Schema.Config("DB_STARTUP_RETRIES", NonNegativeIntFromString).pipe(
    Config.withDefault(5),
  ),
  startupBaseDelay: Config.duration("DB_STARTUP_BASE_DELAY").pipe(
    Config.withDefault(Duration.millis(1000)),
  ),
});

export type DatabaseClientConfig = Effect.Effect.Success<typeof databaseClientConfig>;
export type DatabaseServiceConfig = Effect.Effect.Success<typeof databaseServiceConfig>;

export const loadDatabaseClientConfig = (): DatabaseClientConfig => {
  return Effect.runSync(databaseClientConfig);
};
