# Queue Registry + Seeder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the string-based QueueService with a typed Queue Registry and implement a historical Seeder workflow that feeds the refinery queue using archive sources.

**Architecture:**

- **Queue Registry:** A central registry defines every queue with a schema and payload type.
- **QueueService:** Only accepts queue descriptors, validates payloads, and enqueues typed jobs.
- **Seeder:** A workflow that streams historical BOC entries and enqueues them to the refinery queue.

**Tech Stack:** Effect-TS, @effect/schema, BullMQ, fast-xml-parser.

### Task 1: Queue Registry Core

**Files:**

- Create: `apps/server/src/queues/registry.ts`
- Test: `apps/server/test/queues/registry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { defineQueue, defineQueues } from "../../src/queues/registry";
import { Schema } from "@effect/schema";

it("should define queue descriptors with schema", () => {
  const Payload = Schema.Struct({ id: Schema.String });
  const Queues = defineQueues({
    refinery: defineQueue("refinery-queue", Payload),
  });

  expect(Queues.refinery.name).toBe("refinery-queue");
});
```

**Step 2: Run test to verify it fails**
Run: `bun test apps/server/test/queues/registry.test.ts`
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

```ts
export const defineQueue = <Name extends string, S extends Schema.Schema<any>>(
  name: Name,
  schema: S,
) => ({ name, schema });
export const defineQueues = <T extends Record<string, ReturnType<typeof defineQueue>>>(queues: T) =>
  queues;
```

**Step 4: Run test to verify it passes**
Run: `bun test apps/server/test/queues/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/queues/registry.ts apps/server/test/queues/registry.test.ts
git commit -m "feat(queue): add typed queue registry"
```

### Task 2: QueueService Refactor

**Files:**

- Modify: `apps/server/src/services/queue.ts`
- Modify: `apps/server/src/workflows/watcher.ts`
- Test: `apps/server/test/services/queue.test.ts`

**Step 1: Write failing test**

```ts
it("should reject invalid payloads", async () => {
  const Queues = defineQueues({
    refinery: defineQueue("refinery-queue", Schema.Struct({ id: Schema.String })),
  });

  const badPayload = { id: 123 };
  const program = QueueService.add(Queues.refinery, badPayload);

  await expect(Effect.runPromise(program)).rejects.toBeDefined();
});
```

**Step 2: Run test to verify it fails**
Run: `bun test apps/server/test/services/queue.test.ts`
Expected: FAIL

**Step 3: Implement QueueService changes**

- Update `QueueService.add` signature:
  ```ts
  add: <Q extends QueueDescriptor<any>>(queue: Q, payload: Schema.Type<Q["schema"]>) =>
    Effect<Job<Schema.Type<Q["schema"]>>, QueueError>;
  ```
- Validate payload with `Schema.decodeUnknown` before enqueue.
- Update `makeWorker` to accept queue descriptor instead of name.

**Step 4: Update Watcher**
Replace `queueService.add("refinery-queue", ...)` with `queueService.add(Queues.refinery, ...)`.

**Step 5: Run tests**
Run: `bun test apps/server/test/services/queue.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/services/queue.ts apps/server/src/workflows/watcher.ts apps/server/test/services/queue.test.ts
git commit -m "feat(queue): enforce typed queue registry in QueueService"
```

### Task 3: Seeder Workflow

**Files:**

- Create: `apps/server/src/workflows/seeder.ts`
- Create: `apps/server/test/workflows/seeder.test.ts`

**Step 1: Write failing test**

```ts
it("should enqueue archive items", async () => {
  const items = [{ id: "A" }, { id: "B" }];
  const program = SeederWorkflow.runSeeder(items);
  // assert queueService.add called twice
});
```

**Step 2: Run test to verify it fails**
Run: `bun test apps/server/test/workflows/seeder.test.ts`
Expected: FAIL

**Step 3: Implement Seeder**

- `SeederWorkflow` depends on `QueueService` and a mockable `BocArchiveService`.
- For now, implement a simple stream-based ingestion:
  ```ts
  Effect.forEach(items, (item) => queueService.add(Queues.refinery, item), { concurrency: 5 });
  ```

**Step 4: Run tests**
Run: `bun test apps/server/test/workflows/seeder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/workflows/seeder.ts apps/server/test/workflows/seeder.test.ts
git commit -m "feat(seeder): add historical ingestion workflow"
```
