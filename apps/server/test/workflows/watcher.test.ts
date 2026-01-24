import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { BocService, BocItem } from "../../src/services/boc.js";
import { QueueService } from "../../src/services/queue.js";
import { WatcherWorkflow } from "../../src/workflows/watcher.js";

describe("WatcherWorkflow", () => {
  it("should fetch feed and queue items", async () => {
    const mockItems: BocItem[] = [
      new BocItem({
        title: "Item 1",
        link: "http://link1",
        pubDate: "2023-01-01",
        guid: "guid1",
      }),
      new BocItem({
        title: "Item 2",
        link: "http://link2",
        pubDate: "2023-01-02",
        guid: "guid2",
      }),
    ];

    const BocServiceTest = Layer.succeed(
      BocService,
      BocService.of({
        fetchFeed: () => Effect.succeed(mockItems),
        parseFeed: () => Effect.succeed(mockItems),
      }),
    );

    const addedJobsRef = await Effect.runPromise(Ref.make<any[]>([]));
    const QueueServiceTest = Layer.succeed(
      QueueService,
      QueueService.of({
        add: Effect.fn(function* (queueName, jobName, data) {
          yield* Ref.update(addedJobsRef, (jobs) => [...jobs, { queueName, jobName, data }]);
          return { id: "mock-id", name: jobName, data } as any;
        }),
      }),
    );

    const TestLayer = WatcherWorkflow.Live.pipe(
      Layer.provide(Layer.mergeAll(BocServiceTest, QueueServiceTest)),
    );

    const program = Effect.gen(function* () {
      const watcher = yield* WatcherWorkflow;
      yield* watcher.runWatcher;

      const jobs = yield* Ref.get(addedJobsRef);
      expect(jobs.length).toBe(2);
      expect(jobs[0].queueName).toBe("refinery-queue");
      expect(jobs[0].jobName).toBe("process-boc-item");
      expect(jobs[0].data).toEqual(mockItems[0]);
    });

    await Effect.runPromise(Effect.provide(program, TestLayer));
  });
});
