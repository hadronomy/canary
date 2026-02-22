import { describe, expect, test } from "bun:test";

import { DateTime, Effect } from "effect";

import {
  CollectionRunId,
  ContentHash,
  DocumentId,
  DocumentVersionId,
  IndexingTriggerPayload,
  BoeDocumentIndexWorkflow,
} from "~/collectors/boe/indexing";

describe("boe indexing workflow definition", () => {
  test("derives deterministic execution id from workflow idempotency key", async () => {
    const payload = IndexingTriggerPayload.make({
      runId: CollectionRunId.make("2ec1ec26-6356-4201-b638-6f6a40d22ecf"),
      docId: DocumentId.make("7540afe8-2d34-47b8-a7f0-f09cce578e0f"),
      versionId: DocumentVersionId.make("36289ee5-f248-4c88-bf58-cf2b74f0032b"),
      canonicalId: "boe:BOE-A-1978-31229",
      contentHash: ContentHash.make(
        "8f85ec4f1f2878c87215ea9df53e63f68b612f560d7f808f0f5526ce4ca5ec53",
      ),
      kind: "Update",
      requestedAt: DateTime.unsafeNow(),
    });

    const first = await Effect.runPromise(BoeDocumentIndexWorkflow.executionId(payload));
    const second = await Effect.runPromise(BoeDocumentIndexWorkflow.executionId(payload));

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(10);
  });
});
