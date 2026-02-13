import { Schema } from "effect";
import { Config, Effect, Option, Redacted } from "effect";

export interface AxiomErrorEvent {
  readonly timestamp: string;
  readonly level: "error" | "fatal";
  readonly message: string;
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly stack?: string;
  };
  readonly service: {
    readonly name: string;
    readonly version?: string;
    readonly environment: string;
  };
  readonly traceId?: string;
  readonly spanId?: string;
}

export class AxiomReporterError extends Schema.TaggedError<AxiomReporterError>()(
  "AxiomReporterError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

function normalizeError(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    type: typeof error,
    message: String(error),
  };
}

export class AxiomErrorReporter extends Effect.Service<AxiomErrorReporter>()("AxiomErrorReporter", {
  accessors: true,
  effect: Effect.gen(function* () {
    const config = yield* Config.all({
      apiToken: Config.redacted("AXIOM_API_TOKEN"),
      dataset: Config.string("AXIOM_DATASET"),
      logsDataset: Config.string("AXIOM_LOGS_DATASET").pipe(Config.option),
      url: Config.string("AXIOM_URL").pipe(Config.withDefault("https://api.axiom.co")),
      serviceName: Config.string("AXIOM_SERVICE_NAME").pipe(Config.withDefault("canary-server")),
      serviceVersion: Config.string("AXIOM_SERVICE_VERSION").pipe(Config.option),
      environment: Config.string("AXIOM_ENVIRONMENT").pipe(Config.withDefault("development")),
    });
    const logsDataset = Option.getOrElse(config.logsDataset, () => config.dataset);

    if (Option.isNone(config.logsDataset)) {
      yield* Effect.logWarning(
        "AXIOM_LOGS_DATASET not set; using AXIOM_DATASET. Create and configure a dedicated OTel Logs or Events dataset for logs/errors.",
      );
    }

    const reportError = (event: AxiomErrorEvent) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${config.url}/v1/datasets/${logsDataset}/ingest`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Redacted.value(config.apiToken)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([event]),
          });

          if (!response.ok) {
            throw new Error(`Axiom ingest failed: ${response.status}`);
          }
        },
        catch: (error) =>
          new AxiomReporterError({
            message: "Failed to report error to Axiom",
            cause: error,
          }),
      });

    return {
      report: (error: unknown, context?: { traceId?: string; spanId?: string }) =>
        Effect.gen(function* () {
          const errorInfo = normalizeError(error);
          const event: AxiomErrorEvent = {
            timestamp: new Date().toISOString(),
            level: "error",
            message: errorInfo.message,
            error: errorInfo,
            service: {
              name: config.serviceName,
              version: Option.getOrUndefined(config.serviceVersion),
              environment: config.environment,
            },
            ...context,
          };

          yield* reportError(event).pipe(
            Effect.tapError((e) =>
              Effect.logWarning("Failed to send error to Axiom", { error: e }),
            ),
            Effect.ignore,
          );
        }),
    };
  }),
}) {}
