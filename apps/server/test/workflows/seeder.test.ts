import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { Queues } from "../../src/queues/index.js";
import { BocItem } from "../../src/services/boc.js";
import { QueueService } from "../../src/services/queue.js";
import { BocArchiveService, SeederWorkflow } from "../../src/workflows/seeder.js";

describe("SeederWorkflow", () => {
  it("should enqueue archive items", async () => {
    const mockItems: BocItem[] = [
      new BocItem({
        title: "Item 1",
        link: "http://link1",
        pubDate: "2020-01-01",
        guid: "guid1",
      }),
      new BocItem({
        title: "Item 2",
        link: "http://link2",
        pubDate: "2020-01-02",
        guid: "guid2",
      }),
    ];

    const BocArchiveServiceTest = Layer.succeed(
      BocArchiveService,
      BocArchiveService.of({
        fetchRange: () => Effect.succeed(mockItems),
      }),
    );

    const addedJobsRef = await Effect.runPromise(Ref.make<any[]>([]));
    const QueueServiceTest = Layer.succeed(
      QueueService,
      QueueService.of({
        add: Effect.fn(function* (queueDescriptor, payload) {
          yield* Ref.update(addedJobsRef, (jobs) => [
            ...jobs,
            { queueName: queueDescriptor.name, payload },
          ]);
          return { id: "mock-id", name: queueDescriptor.name, data: payload } as any;
        }),
      }),
    );

    const TestLayer = SeederWorkflow.Live.pipe(
      Layer.provide(Layer.mergeAll(BocArchiveServiceTest, QueueServiceTest)),
    );

    const program = Effect.gen(function* () {
      const seeder = yield* SeederWorkflow;
      yield* seeder.runSeeder({ startYear: 2020, endYear: 2021 });

      const jobs = yield* Ref.get(addedJobsRef);
      expect(jobs).toHaveLength(2);
      expect(jobs[0].queueName).toBe(Queues.refinery.name);
      expect(jobs[0].payload).toEqual(mockItems[0]);
    });

    await Effect.runPromise(Effect.provide(program, TestLayer));
  });
});
