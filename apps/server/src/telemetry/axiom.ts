import { OtlpLogger, OtlpSerialization, OtlpTracer } from "@effect/opentelemetry"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { AxiomConfig } from "./config.js"

export class AxiomTelemetryService extends Effect.Service<AxiomTelemetryService>()(
	"AxiomTelemetryService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const config = yield* AxiomConfig
			const tracesDataset = Option.getOrElse(config.tracesDataset, () => config.dataset)
			const logsDataset = Option.getOrElse(config.logsDataset, () => config.dataset)
			const defaultSampleRate = config.environment === "development" ? 1 : 0.1
			const tracesSampleRate = Option.match(config.tracesSampleRate, {
				onNone: () => defaultSampleRate,
				onSome: (rate) => Math.max(0, Math.min(1, rate)),
			})

			yield* Effect.logInfo("Axiom OTLP routing", {
				serviceName: config.serviceName,
				environment: config.environment,
				traces: {
					endpoint: `${config.url}/v1/traces`,
					dataset: tracesDataset,
					sampleRate: tracesSampleRate,
				},
				logs: {
					endpoint: `${config.url}/v1/logs`,
					dataset: logsDataset,
				},
			})

			if (Option.isNone(config.tracesDataset)) {
				yield* Effect.logWarning(
					"AXIOM_TRACES_DATASET not set; using AXIOM_DATASET. Create and configure a dedicated OTel Traces dataset in Axiom for the Traces UI.",
				)
			}

			if (Option.isNone(config.logsDataset)) {
				yield* Effect.logWarning(
					"AXIOM_LOGS_DATASET not set; using AXIOM_DATASET. Create and configure a dedicated OTel Logs dataset in Axiom.",
				)
			}

			return {
				tracesDataset,
				logsDataset,
				config,
			}
		}),
	},
) {}

export const OtlpInfraLive = Layer.mergeAll(FetchHttpClient.layer, OtlpSerialization.layerProtobuf)

const AxiomOtlpTracerLive = Layer.unwrapEffect(
	Effect.gen(function* () {
		yield* Effect.logInfo("Building OTLP tracer layer")
		const service = yield* AxiomTelemetryService
		const url = `${service.config.url}/v1/traces`
		yield* Effect.logInfo(`OTLP Tracer endpoint: ${url}`)

		return OtlpTracer.layer({
			url,
			resource: {
				serviceName: service.config.serviceName,
				serviceVersion: Option.getOrUndefined(service.config.serviceVersion),
				attributes: {
					"deployment.environment": service.config.environment,
				},
			},
			headers: {
				Authorization: `Bearer ${Redacted.value(service.config.apiToken)}`,
				"X-Axiom-Dataset": service.tracesDataset,
			},
			exportInterval: service.config.batchTimeoutMs,
			maxBatchSize: 1000,
			shutdownTimeout: service.config.shutdownTimeoutMs,
		})
	}),
)

const AxiomOtlpLoggerLive = Layer.unwrapEffect(
	Effect.gen(function* () {
		yield* Effect.logInfo("Building OTLP logger layer")
		const service = yield* AxiomTelemetryService
		const url = `${service.config.url}/v1/logs`
		yield* Effect.logInfo(`OTLP Logger endpoint: ${url}`)

		return OtlpLogger.layer({
			url,
			resource: {
				serviceName: service.config.serviceName,
				serviceVersion: Option.getOrUndefined(service.config.serviceVersion),
				attributes: {
					"deployment.environment": service.config.environment,
				},
			},
			headers: {
				Authorization: `Bearer ${Redacted.value(service.config.apiToken)}`,
				"X-Axiom-Dataset": service.logsDataset,
			},
			exportInterval: service.config.batchTimeoutMs,
			shutdownTimeout: service.config.shutdownTimeoutMs,
		})
	}),
)

export const AxiomTelemetryLive = Layer.unwrapEffect(
	Effect.gen(function* () {
		const apiToken = yield* Config.redacted("AXIOM_API_TOKEN").pipe(Effect.option)

		if (Option.isNone(apiToken)) {
			yield* Effect.logWarning("Axiom telemetry disabled: AXIOM_API_TOKEN not set")
			return Layer.empty
		}

		return Layer.mergeAll(AxiomOtlpTracerLive, AxiomOtlpLoggerLive).pipe(
			Layer.provide(AxiomTelemetryService.Default),
		)
	}),
)
