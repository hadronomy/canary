import { Context, Data, Effect, Layer, Config } from "effect";
import { Queue, Worker, type Job } from "bullmq";

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class QueueService extends Context.Tag("QueueService")<
  QueueService,
  {
    readonly add: (
      queueName: string,
      jobName: string,
      data: unknown,
    ) => Effect.Effect<Job, QueueError>;
  }
>() {}

export const QueueServiceLive = Layer.effect(
  QueueService,
  Effect.gen(function* () {
    const connection = {
      host: yield* Config.string("REDIS_HOST").pipe(Config.withDefault("localhost")),
      port: yield* Config.integer("REDIS_PORT").pipe(Config.withDefault(6379)),
    };

    // Cache for queues to ensure we reuse connections and can close them
    const queues = new Map<string, Queue>();

    const getQueue = (name: string) => {
      if (!queues.has(name)) {
        queues.set(name, new Queue(name, { connection }));
      }
      return queues.get(name)!;
    };

    const add = (queueName: string, jobName: string, data: unknown) =>
      Effect.tryPromise({
        try: async () => {
          const queue = getQueue(queueName);
          return await queue.add(jobName, data);
        },
        catch: (error) => new QueueError({ message: "Failed to add job to queue", cause: error }),
      });

    // Ensure we close all queues when the layer is released
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await Promise.all(Array.from(queues.values()).map((q) => q.close()));
        queues.clear();
      }),
    );

    return { add };
  }),
);

export const QueueServiceTest = Layer.succeed(
  QueueService,
  QueueService.of({
    add: (_queueName, _jobName, _data) =>
      Effect.succeed({ id: "test-job-id", name: _jobName, data: _data } as Job),
  }),
);

// Worker Helper
export const makeWorker = <T>(
  queueName: string,
  processor: (job: Job<T>) => Effect.Effect<void, Error>,
) =>
  Effect.gen(function* () {
    const connection = {
      host: yield* Config.string("REDIS_HOST").pipe(Config.withDefault("localhost")),
      port: yield* Config.integer("REDIS_PORT").pipe(Config.withDefault(6379)),
    };

    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        const worker = new Worker(
          queueName,
          async (job) => {
            return await Effect.runPromise(processor(job));
          },
          { connection },
        );
        return worker;
      }),
      (worker) => Effect.promise(() => worker.close()),
    );
  });
