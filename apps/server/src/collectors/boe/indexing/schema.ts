import { Schema } from "effect";

export const DocumentId = Schema.UUID.pipe(Schema.brand("~/collectors/boe/indexing/DocumentId"));
export type DocumentId = Schema.Schema.Type<typeof DocumentId>;

export const DocumentVersionId = Schema.UUID.pipe(
  Schema.brand("~/collectors/boe/indexing/DocumentVersionId"),
);
export type DocumentVersionId = Schema.Schema.Type<typeof DocumentVersionId>;

export const CollectionRunId = Schema.UUID.pipe(
  Schema.brand("~/collectors/boe/indexing/CollectionRunId"),
);
export type CollectionRunId = Schema.Schema.Type<typeof CollectionRunId>;

export const ContentHash = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("~/collectors/boe/indexing/ContentHash"),
);
export type ContentHash = Schema.Schema.Type<typeof ContentHash>;

export const FragmentKey = Schema.String.pipe(
  Schema.pattern(/^frag_[a-f0-9]{16}$/),
  Schema.brand("~/collectors/boe/indexing/FragmentKey"),
);
export type FragmentKey = Schema.Schema.Type<typeof FragmentKey>;

export const EmbeddingKey = Schema.String.pipe(
  Schema.pattern(/^emb_[a-f0-9]{16}$/),
  Schema.brand("~/collectors/boe/indexing/EmbeddingKey"),
);
export type EmbeddingKey = Schema.Schema.Type<typeof EmbeddingKey>;

export const IndexingTriggerPayload = Schema.Struct({
  runId: CollectionRunId,
  docId: DocumentId,
  versionId: DocumentVersionId,
  canonicalId: Schema.String,
  contentHash: Schema.NullOr(ContentHash),
  kind: Schema.Literal("New", "Update"),
  requestedAt: Schema.DateTimeUtc,
});
export type IndexingTriggerPayload = Schema.Schema.Type<typeof IndexingTriggerPayload>;

export function createFragmentKey(input: {
  readonly versionId: DocumentVersionId;
  readonly ltreePath: string;
  readonly normalizedContent: string;
}): FragmentKey {
  const raw = `${input.versionId}:${input.ltreePath}:${input.normalizedContent}`;
  const digest = Bun.hash(raw, 0n).toString(16).padStart(16, "0");
  return Schema.decodeSync(FragmentKey)(`frag_${digest}`);
}

export function createEmbeddingKey(input: {
  readonly fragmentKey: FragmentKey;
  readonly modelId: string;
}): EmbeddingKey {
  const raw = `${input.fragmentKey}:${input.modelId}`;
  const digest = Bun.hash(raw, 0n).toString(16).padStart(16, "0");
  return Schema.decodeSync(EmbeddingKey)(`emb_${digest}`);
}
