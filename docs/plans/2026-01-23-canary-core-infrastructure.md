# Canary Core Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the foundational "Legislative Time Machine" architecture: Postgres schema with vectors/time-ranges, Jina v4 client layer, and BullMQ orchestration wrapper, all purely functional via Effect-TS.

**Architecture:**

- **Database:** Drizzle + pgvector + custom types for `tstzrange`.
- **AI:** `JinaService` Layer for embeddings (Scout/Full/Multi).
- **Queue:** `QueueService` Layer wrapping BullMQ.
- **Runtime:** Bun + Effect.

**Tech Stack:** Effect-TS, Drizzle ORM, PostgreSQL (pgvector), Jina v4, BullMQ.

### Task 1: Database Schema Implementation

**Files:**

- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/legislation.ts`
- Test: `packages/db/test/schema.test.ts` (create if needed)

**Step 1: Install pgvector dependency**

```bash
bun add pgvector
```

**Step 2: Define Legislation and Chunks Tables**
Create `packages/db/src/schema/legislation.ts` with:

- `legislation` table: id, uid, title, validity (tstzrange), created_at.
- `chunks` table: id, law_id, content, scout_vector (256), full_vector (1024), multi_vector (jsonb).
- Indexes: HNSW on scout_vector.

**Step 3: Export schema**
Update `packages/db/src/schema/index.ts` to export `* from "./legislation"`.

**Step 4: Push DB changes**

```bash
cd packages/db && bun run db:push
```

### Task 2: JinaService Layer

**Files:**

- Create: `apps/server/src/services/jina.ts`
- Test: `apps/server/test/services/jina.test.ts`

**Step 1: Define JinaService Interface**
Create a Tagged Service `JinaService` with methods:

- `embed(text: string): Effect<EmbeddedResult, JinaError>`
- `rerank(query: string, docs: string[]): Effect<RerankResult, JinaError>`

**Step 2: Implement Live Layer**
Implement using `fetch` (wrapped in Effect) to hit Jina v4 API.

- Use `Config` for API Key.
- Handle rate limits/errors.

**Step 3: Create Mock Layer**
For testing/dev without credits.

### Task 3: BullMQ Service Layer

**Files:**

- Create: `apps/server/src/services/queue.ts`
- Create: `apps/server/src/workers/refinery.ts`

**Step 1: Define QueueService Interface**
Tagged Service with:

- `add(queueName: string, jobName: string, data: unknown): Effect<Job, QueueError>`

**Step 2: Implement Live Layer**
Wrap `bullmq` Queue add methods.

**Step 3: Implement Worker Definition Helper**
Create a helper to define Workers that run Effect workflows.

- `makeWorker<T>(queueName: string, processor: (job: Job<T>) => Effect<void, Error>)`
