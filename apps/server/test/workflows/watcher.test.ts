import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { BocService, BocItem } from "~/services/boc";
import { QueueService } from "~/services/queue";
import { Queues } from "~/queues/index";
import { WatcherWorkflow } from "~/workflows/watcher";

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
        add: Effect.fn(function* (queue, payload) {
          yield* Ref.update(addedJobsRef, (jobs) => [...jobs, { queue, payload }]);
          return { id: "mock-id", name: queue.name, data: payload } as any;
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
      expect(jobs[0].queue).toBe(Queues.refinery);
      expect(jobs[0].payload).toEqual(mockItems[0]);
    });

    await Effect.runPromise(Effect.provide(program, TestLayer));
  });

  it("should queue items concurrently", async () => {
    const mockItems: BocItem[] = Array.from(
      { length: 5 },
      (_, i) =>
        new BocItem({
          title: `Item ${i}`,
          link: `http://link${i}`,
          pubDate: "2023-01-01",
          guid: `guid${i}`,
        }),
    );

    const BocServiceTest = Layer.succeed(
      BocService,
      BocService.of({
        fetchFeed: () => Effect.succeed(mockItems),
        parseFeed: () => Effect.succeed(mockItems),
      }),
    );

    const QueueServiceTest = Layer.succeed(
      QueueService,
      QueueService.of({
        add: Effect.fn(function* (_queue, payload) {
          yield* Effect.sleep("100 millis");
          return { id: "mock-id", name: "mock", data: payload } as any;
        }),
      }),
    );

    const TestLayer = WatcherWorkflow.Live.pipe(
      Layer.provide(Layer.mergeAll(BocServiceTest, QueueServiceTest)),
    );

    const program = Effect.gen(function* () {
      const watcher = yield* WatcherWorkflow;
      const start = Date.now();
      yield* watcher.runWatcher;
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(250);
    });

    await Effect.runPromise(Effect.provide(program, TestLayer));
  });
});
