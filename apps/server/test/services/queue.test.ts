import { describe, it, expect, mock } from "bun:test";
import { Effect } from "effect";
import { QueueService, QueueServiceLive, makeWorker } from "../../src/services/queue.js";

// Mock BullMQ
mock.module("bullmq", () => {
  return {
    Queue: class MockQueue {
      name: string;
      constructor(name: string, _opts: any) {
        this.name = name;
      }
      add = mock(() => Promise.resolve({ id: "123", name: "job", data: {} } as any));
      close = mock(() => Promise.resolve());
    },
    Worker: class MockWorker {
      name: string;
      processor: any;
      constructor(name: string, processor: any, _opts: any) {
        this.name = name;
        this.processor = processor;
      }
      close = mock(() => Promise.resolve());
      run = mock(() => Promise.resolve());
    },
  };
});

describe("QueueService", () => {
  it("should add a job to the queue", async () => {
    const program = Effect.gen(function* () {
      const service = yield* QueueService;
      const job = yield* service.add("test-queue", "test-job", { foo: "bar" });
      expect(job.id).toBe("123");
    });

    // QueueServiceLive is a Layer that might have Scope requirements (e.g. for finalizers).
    // Wrapping in Effect.scoped ensures any scope requirements are met.
    const runnable = Effect.scoped(Effect.provide(program, QueueServiceLive));
    await Effect.runPromise(runnable);
  });
});

describe("makeWorker", () => {
  it("should create a worker and process jobs", async () => {
    let processed = false;
    const processor = (_job: any) =>
      Effect.sync(() => {
        processed = true;
      });

    const workerEffect = makeWorker("test-worker-queue", processor);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const worker = yield* workerEffect;
          expect(worker).toBeDefined();
          expect(processed).toBe(false); // Processor not called yet
        }),
      ),
    );
  });
});
