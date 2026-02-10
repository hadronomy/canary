import { describe, expect, test } from "bun:test";

import { Cause, FiberId, FiberRefs, HashMap, List, Logger, LogLevel } from "effect";

import { makeAppStringLogger } from "~/logging/logger";

describe("app logger formatter", () => {
  test("formats structured payloads as pretty labeled JSON without noisy context", () => {
    const logger = makeAppStringLogger({ noColor: true });

    const output = Logger.test(logger, [
      "Existing source documents found; unchanged items will be skipped",
      {
        factoryId: "boe-laws",
        sourceId: "019c3a97-5a2e-7037-bb20-5cf812cc8933",
        existingDocuments: 12176,
      },
    ]);

    expect(output).toContain("Existing source documents found; unchanged items will be skipped");
    expect(output).toContain("Message:");
    expect(output).toContain("Payload:");
    expect(output).toContain('"factoryId": "boe-laws"');
    expect(output).toContain('"sourceId": "019c3a97-5a2e-7037-bb20-5cf812cc8933"');
    expect(output).toContain('"existingDocuments": 12176');
    expect(output).not.toContain("Context:");
  });

  test("renders cause blocks with tree structure", () => {
    const logger = makeAppStringLogger({ noColor: true });

    const output = logger.log({
      fiberId: FiberId.none,
      logLevel: LogLevel.Error,
      message: "Failed to process payment",
      cause: Cause.fail(new Error("Insufficient funds")),
      context: FiberRefs.empty(),
      spans: List.empty(),
      annotations: HashMap.empty(),
      date: new Date("2026-02-09T12:00:00.000Z"),
    });

    expect(output).toContain("✖ Cause");
    expect(output).toContain("Insufficient funds");
    expect(output).toContain("Message: Failed to process payment");
    expect(output).toContain("Error: Insufficient funds");
  });

  test("renders nested cause chains with caused-by arrows", () => {
    const logger = makeAppStringLogger({ noColor: true });
    const rootCause = new Error("Root failure", {
      cause: new Error("Nested failure"),
    });

    const output = logger.log({
      fiberId: FiberId.none,
      logLevel: LogLevel.Error,
      message: "Nested failure test",
      cause: Cause.fail(rootCause),
      context: FiberRefs.empty(),
      spans: List.empty(),
      annotations: HashMap.empty(),
      date: new Date("2026-02-09T12:00:00.000Z"),
    });

    expect(output).toContain("✖ Cause");
    expect(output).toContain("╰→ caused by");
    expect(output).toContain("Nested failure");
  });
});
