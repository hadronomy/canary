import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { Effect, Layer, Logger, LogLevel, ConfigProvider } from "effect";

import { AppLoggerLive } from "../logging/logger.js";
import { AxiomTelemetryLive, OtlpInfraLive } from "./axiom.js";

interface CapturedRequest {
  path: string;
  body: Uint8Array;
}

const requests: Array<CapturedRequest> = [];
let mockServer: ReturnType<typeof Bun.serve> | undefined;
let mockPort = 0;

const startMockServer = () => {
  requests.length = 0;
  mockServer = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const body = new Uint8Array(await req.arrayBuffer());
      requests.push({ path: url.pathname, body });
      console.log(`[Mock Server] ${req.method} ${url.pathname} (${body.length} bytes)`);
      return new Response(JSON.stringify({ partialSuccess: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  mockPort = mockServer.port as number;
  return mockPort;
};

const createConfigLayer = (port: number) =>
  Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["AXIOM_URL", `http://localhost:${port}`],
        ["AXIOM_API_TOKEN", "test-token"],
        ["AXIOM_DATASET", "test-dataset"],
        ["AXIOM_TRACES_DATASET", "test-traces"],
        ["AXIOM_LOGS_DATASET", "test-logs"],
      ]),
    ),
  );

describe("Axiom OTLP Integration", () => {
  beforeAll(() => {
    startMockServer();
  });

  afterAll(() => {
    mockServer?.stop();
  });

  it("should export traces via OTLP", async () => {
    const configLayer = createConfigLayer(mockPort);

    const testLayer = Layer.provide(
      Layer.mergeAll(AxiomTelemetryLive, Logger.minimumLogLevel(LogLevel.Debug)),
      Layer.mergeAll(AppLoggerLive, OtlpInfraLive, configLayer),
    );

    const tracedWork = Effect.gen(function* () {
      yield* Effect.logInfo("Inside traced span");
      yield* Effect.sleep(50);
      return "work-done";
    });

    const program = Effect.gen(function* () {
      yield* Effect.logInfo("Test log message for OTLP");

      yield* tracedWork.pipe(
        Effect.withSpan("test-operation", {
          attributes: { "test.attribute": "value" },
        }),
      );

      return "success";
    }).pipe(
      Effect.tap(() => Effect.sleep(100)),
      Effect.tap(() => Effect.logInfo("After span, checking exports")),
      Effect.tap(() => Effect.sleep(1000)),
    );

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("\n=== Captured Requests ===");
    for (const req of requests) {
      console.log(`- ${req.path}: ${req.body.length} bytes`);
    }
    console.log("========================\n");

    const tracesRequests = requests.filter((r) => r.path === "/v1/traces");
    expect(tracesRequests.length).toBeGreaterThan(0);
  }, 10000);

  it("should export logs via OTLP", async () => {
    requests.length = 0;

    const configLayer = createConfigLayer(mockPort);

    const testLayer = Layer.provide(
      Layer.mergeAll(AxiomTelemetryLive, Logger.minimumLogLevel(LogLevel.Debug)),
      Layer.mergeAll(AppLoggerLive, OtlpInfraLive, configLayer),
    );

    const program = Effect.gen(function* () {
      yield* Effect.logInfo("First test message");
      yield* Effect.logWarning("Warning test message");
      yield* Effect.logError("Error test message");
      yield* Effect.logDebug("Debug test message");

      return "done";
    }).pipe(Effect.tap(() => Effect.sleep(500)));

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("\n=== Captured Log Requests ===");
    for (const req of requests) {
      console.log(`- ${req.path}: ${req.body.length} bytes`);
    }
    console.log("=============================\n");

    const logsRequests = requests.filter((r) => r.path === "/v1/logs");
    expect(logsRequests.length).toBeGreaterThan(0);
  }, 10000);
});
