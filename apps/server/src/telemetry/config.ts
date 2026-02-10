import { Config, Duration } from "effect"

export const AxiomConfig = Config.all({
	apiToken: Config.redacted("AXIOM_API_TOKEN"),
	dataset: Config.string("AXIOM_DATASET"),
	tracesDataset: Config.string("AXIOM_TRACES_DATASET").pipe(Config.option),
	logsDataset: Config.string("AXIOM_LOGS_DATASET").pipe(Config.option),
	environment: Config.string("AXIOM_ENVIRONMENT").pipe(Config.withDefault("development")),
	serviceName: Config.string("AXIOM_SERVICE_NAME").pipe(Config.withDefault("canary-server")),
	serviceVersion: Config.string("AXIOM_SERVICE_VERSION").pipe(Config.option),
	url: Config.string("AXIOM_URL").pipe(Config.withDefault("https://api.axiom.co")),
	tracesSampleRate: Config.number("AXIOM_TRACES_SAMPLE_RATE").pipe(Config.option),
	shutdownTimeoutMs: Config.integer("AXIOM_SHUTDOWN_TIMEOUT_MS").pipe(
		Config.withDefault(3000),
		Config.map(Duration.millis),
	),
	batchTimeoutMs: Config.integer("AXIOM_BATCH_TIMEOUT_MS").pipe(
		Config.withDefault(50),
		Config.map(Duration.millis),
	),
})

export type AxiomConfigShape = typeof AxiomConfig extends Config.Config<infer A> ? A : never
