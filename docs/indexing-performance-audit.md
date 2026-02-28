# Server + BOE Indexing Pipeline Performance Audit

## Scope

This audit covers:

1. The latest commit (`eb49485 feat: add indexing workflow`).
2. The BOE server indexing path end-to-end (`collector -> workflow -> parser -> fragments -> embeddings`).
3. Immediate memory pressure sources related to the reported ~11GB RSS.

## Executive summary

The largest memory amplification points are concentrated in the indexing path, not in generic server request handling:

1. **Large payload retention at collector level** (keeping full `contentText` in multiple arrays/maps before workflows trigger).
2. **Wide materialization during embedding** (large text batches and vector arrays held at once).
3. **Embedding response cloning** (duplicating vector arrays in-memory via spread operators).
4. **Potential over-selection in upsert/readback** (fetching rows again after write in a separate query).

The last commit introduced a robust workflow structure, but also increased object lifetime and batch-level accumulation in memory due to orchestration and payload staging. The pipeline is reliable, but not yet memory-lean under large runs.

## What was changed in this patch

### 1) Removed unnecessary embedding vector cloning

In `EmbeddingService`, the response mapping was cloning full vectors and multi-vectors with spread (`[...item.embedding]`, `map([...vector])`). This creates a full second copy of each embedding payload in JS heap.

Now the service returns provider arrays directly and only slices for the 256-dim scout vector.

**Impact:** lower transient heap usage and less GC pressure when embedding large batches.

### 2) Reduced post-upsert re-read overhead in indexing activities

`upsertFragments` previously inserted/upserted rows and then executed a second select to fetch all fragment IDs/content for the version. This doubles query work and can materialize large arrays.

Now it uses `.returning({ fragmentId, content })` directly from the upsert and skips the second read.

**Impact:** fewer DB round trips and lower allocation churn.

### 3) Chunked embedding persistence work

`embedFragments` previously embedded all fragment texts of a document/version in one call and then updated rows. This is the highest memory spike path.

Now rows are processed in chunks (`EMBEDDING_BATCH_SIZE = 32`) and each chunk is embedded/persisted sequentially.

**Impact:** bounded memory profile per chunk and smoother throughput under heavy docs.

### 4) Removed large-content return/matching in collector version ingest

Collector ingest was returning `contentText` from inserted `document_versions` rows and using `${docId}:${contentText}` as map keys.

Now it maps by `docId` and returns only `{ versionId, docId }` from insert statements.

**Impact:** avoids hauling large text columns back from DB and removes huge map-key strings.

## Deep-dive findings (current bottlenecks and offloading opportunities)

## A. Collector ingestion hot path

**Current behavior:**

- Builds `persistable`, `newVersionRows`, `updateCandidates`, then `indexingPayloads` in-memory before workflow triggering.
- `contentText` remains live in multiple structures for long windows.

**Optimization options:**

1. Stream ingestion in smaller batches and trigger indexing per batch.
2. Persist lightweight indexing jobs first, then let worker pull/execute jobs (queue-backed decoupling).
3. Avoid carrying `contentText` in multiple intermediate arrays; keep one canonical reference per item.

## B. Parser to fragment fanout

**Current behavior:**

- `parseDocument` returns full fragment array with multiple string fields per fragment.
- `upsertFragments` remaps again to DB row objects.

**Optimization options:**

1. Parse to `Chunk` and flush to DB in windowed chunks (`Stream` + `grouped`).
2. Reuse structural fields or intern repeated strings when possible (node types/titles).
3. Add hard safeguards: max fragments per document with explicit error/fallback mode.

## C. Embedding generation

**Current behavior:**

- Still stores vectors in app process before update statements (though now chunked).

**Optimization options:**

1. Move embedding generation to dedicated worker service (separate process memory budget).
2. Use queue-based fragment embedding tasks with adaptive concurrency.
3. Persist only required vector forms per stage (for example avoid multi-vector unless query path needs it).

## D. DB write amplification

**Current behavior:**

- Embeddings are persisted row-by-row updates.

**Optimization options:**

1. Batch updates using SQL `VALUES`/`UNNEST` update join patterns.
2. Add copy/bulk ingestion path for embeddings when supported.
3. Consider deferred embedding write mode (ingest now, embed async).

## E. Workflow runtime configuration

**Current behavior:**

- Workflow engine can run in-memory or sqlite-backed.
- `startMany` uses concurrency 1, safe but may increase total run time.

**Optimization options:**

1. Keep durable engine (sqlite/sql) for resumability and memory stability.
2. Tune trigger concurrency based on CPU/network saturation and heap watermark.
3. Instrument queue depth + stage latency + heap snapshots per stage.

## Effect primitive recommendations (for future refactors)

To keep the code idiomatic and type-safe while improving performance:

1. Use `Stream` + `Stream.grouped` / `Stream.mapEffect` for bounded chunk pipelines.
2. Use `Chunk` for large sequence transforms instead of repeated array copies.
3. Use `Effect.forEach` with explicit `concurrency` plus chunking boundaries.
4. Model stage failures with tagged errors (already done well) and keep retry localized per activity.
5. Use `Layer` boundaries to isolate heavy services (embedding, parser) and optionally run out-of-process.

## Suggested rollout plan

### Phase 1 (done in this patch)

- Remove embedding clones.
- Chunk embed calls.
- Remove extra readback query after upsert.
- Avoid large `contentText` roundtrip/matching in collector ingest.

### Phase 2 (high ROI)

- Queue-first architecture for embeddings (decouple from indexing transaction).
- Parser/fragment streaming to DB with bounded chunk windows.
- Batch SQL update for embeddings.

### Phase 3 (scale hardening)

- Dedicated embedding worker pool with independent autoscaling.
- Stage-level circuit breakers and adaptive concurrency controls.
- Memory SLOs and heap profiling integrated into CI/load tests.

## Validation guidance

Track these metrics before/after:

1. Peak RSS per indexing run.
2. Time-to-index per document and per 1k fragments.
3. Embedding API payload sizes and latency p95.
4. DB write throughput + lock/wait stats.
5. Workflow retry rates by stage.

A realistic near-term target is **reducing peak memory by 30-60%** on large indexing batches with the chunking + de-dup + roundtrip reductions alone.
