import { NodeSdk } from "@effect/opentelemetry";
import * as OtelApi from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import {
  SentryPropagator,
  SentrySampler,
  SentrySpanProcessor,
  setOpenTelemetryContextAsyncContextStrategy,
} from "@sentry/opentelemetry";
import { Config, Context, Duration, Effect, Layer, Option } from "effect";

type SentryClientInstance = NonNullable<ReturnType<typeof Sentry.getClient>>;

class SentryClient extends Context.Tag("@canary/telemetry/SentryClient")<
  SentryClient,
  SentryClientInstance
>() {}

interface TelemetryConfig {
  readonly sentryDsn: Option.Option<string>;
  readonly sentryEnvironment: string;
  readonly sentryRelease: Option.Option<string>;
  readonly sentryTracesSampleRate: Option.Option<number>;
  readonly sentrySpanProcessorTimeoutMs: number;
  readonly otelServiceName: string;
  readonly otelServiceVersion: Option.Option<string>;
  readonly otelShutdownTimeout: Duration.Duration;
}

interface EnabledTelemetryConfig extends Omit<TelemetryConfig, "sentryDsn"> {
  readonly sentryDsn: string;
}

const TelemetryConfig = Config.all({
  sentryDsn: Config.string("SENTRY_DSN").pipe(Config.option),
  sentryEnvironment: Config.string("SENTRY_ENVIRONMENT").pipe(Config.withDefault("development")),
  sentryRelease: Config.string("SENTRY_RELEASE").pipe(Config.option),
  sentryTracesSampleRate: Config.number("SENTRY_TRACES_SAMPLE_RATE").pipe(Config.option),
  sentrySpanProcessorTimeoutMs: Config.integer("SENTRY_SPAN_PROCESSOR_TIMEOUT_MS").pipe(
    Config.withDefault(500),
  ),
  otelServiceName: Config.string("OTEL_SERVICE_NAME").pipe(Config.withDefault("canary-server")),
  otelServiceVersion: Config.string("OTEL_SERVICE_VERSION").pipe(Config.option),
  otelShutdownTimeout: Config.integer("OTEL_SHUTDOWN_TIMEOUT_MS").pipe(
    Config.withDefault(3000),
    Config.map(Duration.millis),
  ),
});

function makeSentryLive(config: EnabledTelemetryConfig) {
  const defaultSampleRate = config.sentryEnvironment === "development" ? 1 : 0.1;
  const tracesSampleRate = Math.max(
    0,
    Math.min(
      1,
      Option.match(config.sentryTracesSampleRate, {
        onNone: () => defaultSampleRate,
        onSome: (value) => value,
      }),
    ),
  );

  return Layer.scoped(
    SentryClient,
    Effect.acquireRelease(
      Effect.sync(() => {
        Sentry.init({
          dsn: config.sentryDsn,
          environment: config.sentryEnvironment,
          release: Option.getOrUndefined(config.sentryRelease),
          tracesSampleRate,
          enableLogs: true,
          skipOpenTelemetrySetup: true,
        });

        OtelApi.context.setGlobalContextManager(new Sentry.SentryContextManager());
        OtelApi.propagation.setGlobalPropagator(new SentryPropagator());
        setOpenTelemetryContextAsyncContextStrategy();

        const client = Sentry.getClient();
        if (!client) {
          throw new Error("Sentry client was not initialized");
        }

        return client;
      }),
      () =>
        Effect.promise(() => Sentry.close(Duration.toMillis(config.otelShutdownTimeout))).pipe(
          Effect.ignoreLogged,
        ),
    ),
  );
}

function makeNodeSdkLive(config: EnabledTelemetryConfig) {
  const sentryLive = makeSentryLive(config);

  return NodeSdk.layer(
    Effect.gen(function* () {
      const client = yield* SentryClient;
      return {
        resource: {
          serviceName: config.otelServiceName,
          serviceVersion: Option.getOrUndefined(config.otelServiceVersion),
        },
        spanProcessor: new SentrySpanProcessor({
          timeout: config.sentrySpanProcessorTimeoutMs,
        }),
        tracerConfig: {
          sampler: new SentrySampler(client),
        },
        shutdownTimeout: config.otelShutdownTimeout,
      };
    }),
  ).pipe(Layer.provide(sentryLive));
}

export const TelemetryLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* TelemetryConfig;
    if (Option.isNone(config.sentryDsn)) {
      return Layer.empty;
    }

    return makeNodeSdkLive({
      ...config,
      sentryDsn: config.sentryDsn.value,
    });
  }),
);
