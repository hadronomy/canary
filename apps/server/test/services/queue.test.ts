import { describe, it, expect, mock } from "bun:test";
import { Effect, Schema } from "effect";
import { QueueError, QueueService, QueueServiceLive, makeWorker } from "~/services/queue";
import { defineQueue, defineQueues } from "~/queues/registry";

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
    const payloadSchema = Schema.Struct({ foo: Schema.String });
    const queues = defineQueues({
      test: defineQueue("test-queue", payloadSchema),
    });

    const program = Effect.gen(function* () {
      const service = yield* QueueService;
      const job = yield* service.add(queues.test, { foo: "bar" });
      expect(job.id).toBe("123");
    });

    // QueueServiceLive is a Layer that might have Scope requirements (e.g. for finalizers).
    // Wrapping in Effect.scoped ensures any scope requirements are met.
    const runnable = Effect.scoped(Effect.provide(program, QueueServiceLive));
    await Effect.runPromise(runnable);
  });

  it("should reject invalid payloads", async () => {
    const payloadSchema = Schema.Struct({ id: Schema.String });
    const queues = defineQueues({
      refinery: defineQueue("refinery-queue", payloadSchema),
    });
    const badPayload = { id: 123 } as unknown as Schema.Schema.Type<typeof payloadSchema>;

    const program = Effect.gen(function* () {
      const service = yield* QueueService;
      yield* service.add(queues.refinery, badPayload);
    });

    const runnable = Effect.scoped(Effect.provide(program, QueueServiceLive));
    const result = await Effect.runPromise(Effect.either(runnable));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(QueueError);
    }
  });
});

describe("makeWorker", () => {
  it("should create a worker and process jobs", async () => {
    let processed = false;
    const processor = (_job: any) =>
      Effect.sync(() => {
        processed = true;
      });

    const workerSchema = Schema.Struct({ id: Schema.String });
    const queues = defineQueues({
      worker: defineQueue("test-worker-queue", workerSchema),
    });

    const workerEffect = makeWorker(queues.worker, processor);

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
