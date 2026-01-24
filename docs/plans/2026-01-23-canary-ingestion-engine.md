# Canary Ingestion Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Implement the "Delightful" JinaService 2.0 (polymorphic inputs) and the "Watcher" mechanism for real-time BOC feed ingestion.

**Architecture:**

- **JinaService 2.0:** Polymorphic input (Text/Blob/Buffer) -> Normalize -> Jina v4 API.
- **Watcher:** Effect-based Cron/Stream -> Parse RSS -> Dedup (Redis/DB) -> Queue.
- **Queue:** Existing BullMQ wrapper.

**Tech Stack:** Effect-TS, Jina v4, BullMQ, fast-xml-parser (for RSS).

### Task 1: Delightful JinaService 2.0

**Files:**

- Modify: `apps/server/src/services/jina.ts`
- Modify: `apps/server/test/services/jina.test.ts`

**Step 1: Define Polymorphic Input Types**
Define `JinaInput` as `string | Uint8Array | Blob | { text?: string, image?: string | Uint8Array | Blob }`.

**Step 2: Implement Input Normalizer**
Create a helper to convert inputs to Jina v4 JSON structure:

- String -> `{ text: ... }` or `{ url: ... }` (if regex matches URL)
- Blob/Buffer -> Base64 encoded string -> `{ image: ... }`
- Object -> Pass through with normalization.

**Step 3: Update `embed` signature**
Change `embed(text: string)` to `embed(input: JinaInput | JinaInput[])`.

**Step 4: Update Tests**
Add cases for Buffer/Blob/Object inputs.

### Task 2: The Watcher (Feed Parser)

**Files:**

- Create: `apps/server/src/services/boc.ts`
- Test: `apps/server/test/services/boc.test.ts`

**Step 1: Install Dependencies**

```bash
bun add fast-xml-parser
```

**Step 2: Define BOC Service**
Tagged Service `BocService` with:

- `fetchFeed(): Effect<BocItem[], BocError>`
- `parseFeed(xml: string): Effect<BocItem[], BocError>`

**Step 3: Implement Parser**
Use `fast-xml-parser` to extract Title, Link, PubDate, Guid from the BOC RSS feed.

### Task 3: The Watcher (Orchestrator)

**Files:**

- Create: `apps/server/src/workflows/watcher.ts` (or similar)
- Test: `apps/server/test/workflows/watcher.test.ts`

**Step 1: Define Workflow**
Create an Effect workflow that:

1. Calls `BocService.fetchFeed`
2. Filters items already in DB/Redis (Mock dedup for now or use DB check)
3. Queues new items to `refinery-queue` using `QueueService`.

**Step 2: Schedule**
Expose a `runWatcher` effect that can be scheduled (e.g., `Effect.repeat`).
