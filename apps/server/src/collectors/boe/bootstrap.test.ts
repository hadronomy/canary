import { describe, expect, test } from "bun:test";

import { Effect, Either, Layer } from "effect";

import { DatabaseService, DatabaseUnavailableError } from "@canary/db/effect";

import { countDocumentsForSource, ensureBoeSource } from "./bootstrap";

const failingDatabaseService = {
  ready: () =>
    Effect.fail(new DatabaseUnavailableError({ operation: "ready", message: "offline" })),
  healthCheck: () =>
    Effect.fail(new DatabaseUnavailableError({ operation: "healthCheck", message: "offline" })),
  client: () =>
    Effect.fail(new DatabaseUnavailableError({ operation: "client", message: "offline" })),
};

const failingDatabaseLayer = Layer.succeed(
  DatabaseService,
  failingDatabaseService as unknown as DatabaseService,
);

describe("boe bootstrap", () => {
  test("ensureBoeSource remaps database availability failures", async () => {
    const result = await Effect.runPromise(
      Effect.either(ensureBoeSource()).pipe(Effect.provide(failingDatabaseLayer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BoeBootstrapError");
      expect(result.left.operation).toBe("ensureBoeSource");
    }
  });

  test("countDocumentsForSource remaps database availability failures", async () => {
    const result = await Effect.runPromise(
      Effect.either(countDocumentsForSource("00000000-0000-0000-0000-000000000000")).pipe(
        Effect.provide(failingDatabaseLayer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BoeBootstrapError");
      expect(result.left.operation).toBe("countDocumentsForSource");
    }
  });
});
