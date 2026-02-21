import { describe, expect, test } from "bun:test";

import { Effect, Either } from "effect";

import { assertFragmentInvariants } from "~/collectors/boe/parser";
import { NodePathString } from "~/collectors/boe/parser/types";

import { boeParserMetadata as parserMetadata } from "../common";

describe("invariants.ts - direct testing", () => {
  test("assertFragmentInvariants detects duplicate node paths", async () => {
    const fragmentsWithDuplicate = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
      {
        content: "Second fragment with same path",
        contentNormalized: "Second fragment with same path",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 1,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithDuplicate)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NodePathCollisionError");
    }
  });

  test("assertFragmentInvariants detects empty content", async () => {
    const fragmentsWithEmptyContent = [
      {
        content: "",
        contentNormalized: "",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithEmptyContent)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("EmptyFragmentContentError");
    }
  });

  test("assertFragmentInvariants detects sequence index mismatch", async () => {
    const fragmentsWithWrongSequence = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 5,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(
      Effect.either(assertFragmentInvariants(fragmentsWithWrongSequence)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NodePathCollisionError");
      expect(result.left.message).toContain("Unexpected sequence index");
    }
  });

  test("assertFragmentInvariants passes with valid fragments", async () => {
    const validFragments = [
      {
        content: "First fragment",
        contentNormalized: "First fragment",
        nodePath: NodePathString("/p/1"),
        nodeType: "paragraph" as const,
        sequenceIndex: 0,
        metadata: parserMetadata,
      },
      {
        content: "Second fragment",
        contentNormalized: "Second fragment",
        nodePath: NodePathString("/p/2"),
        nodeType: "paragraph" as const,
        sequenceIndex: 1,
        metadata: parserMetadata,
      },
    ];

    const result = await Effect.runPromise(Effect.either(assertFragmentInvariants(validFragments)));

    expect(Either.isRight(result)).toBe(true);
  });

  test("assertFragmentInvariants passes with empty fragments array", async () => {
    const result = await Effect.runPromise(Effect.either(assertFragmentInvariants([])));
    expect(Either.isRight(result)).toBe(true);
  });
});
