# Typed Queue Registry + Seeder Design

**Goal:** Introduce a central, typed Queue Registry that enforces payload types at compile time and runtime, then build a historical Seeder that uses the registry to enqueue validated BOC items for processing.

## Architecture Overview

**Typed Queue Registry**

- A central registry defines all queues and their payload schemas.
- Only registry queues are accepted by `QueueService.add` and `makeWorker`.
- Each queue descriptor carries:
  - `name` (string literal)
  - `schema` (Effect Schema for runtime validation)
  - `Payload` type (inferred from schema)

**Queue Service API (Strict)**

- `QueueService.add(queue, payload)` accepts only queue descriptors.
- Payloads are validated with the queue schema before enqueueing.
- Returns `Job<Payload>` from BullMQ.

**Worker API**

- `makeWorker(queue, handler)` infers `Job<Payload>` for the handler.
- Handlers run via Effect runtime for correct supervision and error handling.

**Seeder Workflow**

- `BocArchiveService` fetches historical BOC entries (from archive/search endpoints).
- `SeederWorkflow` streams items and enqueues via `Queues.refinery`.
- Supports:
  - `runSeeder({ startYear, endYear })` (manual CLI trigger)
  - `runSeederDaemon()` (continuous gap filling)

## Components

### 1) Queue Registry

- `defineQueue(name, schema)` → queue descriptor
- `defineQueues({...})` → registry object

### 2) QueueService

- `add(queue, payload)` validates & enqueues
- `makeWorker(queue, handler)` typed worker

### 3) BocArchiveService

- `fetchArchivePage(params)`
- `parseArchivePage(html/xml)`
- `streamArchive(startYear, endYear)` (Effect Stream)

### 4) SeederWorkflow

- `runSeeder(input)` iterates archive items and enqueues
- `runSeederDaemon()` uses Schedule + backoff

## Data Flow

1. **Archive fetch** → `BocArchiveService`
2. **Validation** → schema validation per queue
3. **Enqueue** → `QueueService.add(Queues.refinery, item)`
4. **Worker** → `makeWorker(Queues.refinery, handler)`

## Error Handling

- `QueueService.add` returns `QueueError` with cause
- `BocArchiveService` returns `BocArchiveError` with parse + fetch errors
- Seeder logs and skips invalid items (configurable)

## Testing Strategy

- Queue registry: type-level tests (TS) + runtime schema validation tests
- QueueService: mock BullMQ calls; ensure schema validation triggers
- Seeder: mock `BocArchiveService` and assert all items are queued

## Open Questions / Inputs Needed

- Confirm official BOC archive/search endpoints for 1983+.
- Decide whether Seeder should skip invalid items or fail the run.
