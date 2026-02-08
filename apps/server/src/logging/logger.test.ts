import { describe, expect, test } from "bun:test";

import { Logger } from "effect";

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
    expect(output).toContain("data:");
    expect(output).toContain('"factoryId": "boe-laws"');
    expect(output).toContain('"sourceId": "019c3a97-5a2e-7037-bb20-5cf812cc8933"');
    expect(output).toContain('"existingDocuments": 12176');
    expect(output).not.toContain("context:");
  });
});
