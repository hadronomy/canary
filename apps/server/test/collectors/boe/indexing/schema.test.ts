import { describe, expect, test } from "bun:test";

import { DateTime } from "effect";

import {
  CollectionRunId,
  ContentHash,
  DocumentId,
  DocumentVersionId,
  IndexingTriggerPayload,
  createEmbeddingKey,
  createFragmentKey,
} from "~/collectors/boe/indexing";

describe("boe indexing schema", () => {
  test("creates deterministic fragment key", () => {
    const versionId = DocumentVersionId.make("2ec1ec26-6356-4201-b638-6f6a40d22ecf");
    const first = createFragmentKey({
      versionId,
      ltreePath: "n_c_1.n_a_1.n_p_1",
      normalizedContent: "texto normalizado",
    });
    const second = createFragmentKey({
      versionId,
      ltreePath: "n_c_1.n_a_1.n_p_1",
      normalizedContent: "texto normalizado",
    });

    expect(first).toBe(second);
    expect(String(first)).toMatch(/^frag_[0-9a-f]{16}$/);
  });

  test("creates deterministic embedding key from fragment key + model", () => {
    const fragmentKey = createFragmentKey({
      versionId: DocumentVersionId.make("2ec1ec26-6356-4201-b638-6f6a40d22ecf"),
      ltreePath: "n_c_1.n_a_1",
      normalizedContent: "abc",
    });

    const first = createEmbeddingKey({ fragmentKey, modelId: "jina-embeddings-v4-1024" });
    const second = createEmbeddingKey({ fragmentKey, modelId: "jina-embeddings-v4-1024" });
    const third = createEmbeddingKey({ fragmentKey, modelId: "jina-embeddings-v4-256" });

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(String(first)).toMatch(/^emb_[0-9a-f]{16}$/);
  });

  test("indexing payload schema accepts expected trigger shape", () => {
    const now = DateTime.unsafeNow();
    const payload = IndexingTriggerPayload.make({
      runId: CollectionRunId.make("2ec1ec26-6356-4201-b638-6f6a40d22ecf"),
      docId: DocumentId.make("7540afe8-2d34-47b8-a7f0-f09cce578e0f"),
      versionId: DocumentVersionId.make("36289ee5-f248-4c88-bf58-cf2b74f0032b"),
      canonicalId: "boe:BOE-A-1978-31229",
      contentHash: ContentHash.make(
        "8f85ec4f1f2878c87215ea9df53e63f68b612f560d7f808f0f5526ce4ca5ec53",
      ),
      kind: "Update",
      requestedAt: now,
    });

    expect(payload.kind).toBe("Update");
    expect(String(payload.docId)).toBe("7540afe8-2d34-47b8-a7f0-f09cce578e0f");
  });
});
