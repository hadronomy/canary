import { Config, Context, Effect, Layer, Runtime, Schema } from "effect";
import { Queue, Worker, type Job } from "bullmq";
import type { QueueDescriptor } from "~/queues/registry";

type QueuePayload<Q extends QueueDescriptor<string, Schema.Schema.AnyNoContext>> =
  Schema.Schema.Type<Q["schema"]>;

export class QueueError extends Schema.TaggedError<QueueError>()("QueueError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class QueueService extends Context.Tag("QueueService")<
  QueueService,
  {
    readonly add: <Q extends QueueDescriptor<string, Schema.Schema.AnyNoContext>>(
      queue: Q,
      payload: QueuePayload<Q>,
    ) => Effect.Effect<Job<QueuePayload<Q>>, QueueError>;
  }
>() {}

export const QueueServiceLive = Layer.scoped(
  QueueService,
  Effect.gen(function* () {
    const connection = {
      host: yield* Config.string("REDIS_HOST").pipe(Config.withDefault("localhost")),
      port: yield* Config.integer("REDIS_PORT").pipe(Config.withDefault(6379)),
    };

    const queues = new Map<string, Queue>();

    const getQueue = (name: string) => {
      if (!queues.has(name)) {
        queues.set(name, new Queue(name, { connection }));
      }
      return queues.get(name)!;
    };

    const add = Effect.fn("QueueService.add")(function* <
      Q extends QueueDescriptor<string, Schema.Schema.AnyNoContext>,
    >(queueDescriptor: Q, payload: QueuePayload<Q>) {
      const decoded = yield* Schema.decodeUnknown(queueDescriptor.schema)(payload).pipe(
        Effect.mapError(
          (error) => new QueueError({ message: "Invalid queue payload", cause: error }),
        ),
      );

      return yield* Effect.tryPromise({
        try: async () => {
          const queue = getQueue(queueDescriptor.name);
          return await queue.add(queueDescriptor.name, decoded);
        },
        catch: (error) => new QueueError({ message: "Failed to add job to queue", cause: error }),
      });
    });

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
    add: <Q extends QueueDescriptor<string, Schema.Schema.AnyNoContext>>(
      queueDescriptor: Q,
      payload: QueuePayload<Q>,
    ) =>
      Effect.succeed({
        id: "test-job-id",
        name: queueDescriptor.name,
        data: payload,
      } as Job<QueuePayload<Q>>),
  }),
);

export const makeWorker = Effect.fn(function* <
  Q extends QueueDescriptor<string, Schema.Schema.AnyNoContext>,
  R,
>(queueDescriptor: Q, processor: (job: Job<QueuePayload<Q>>) => Effect.Effect<void, Error, R>) {
  const connection = {
    host: yield* Config.string("REDIS_HOST").pipe(Config.withDefault("localhost")),
    port: yield* Config.integer("REDIS_PORT").pipe(Config.withDefault(6379)),
  };
  const runtime = yield* Effect.runtime<R>();

  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      const worker = new Worker(
        queueDescriptor.name,
        async (job) => {
          return await Runtime.runPromise(runtime)(processor(job as Job<QueuePayload<Q>>));
        },
        { connection },
      );
      return worker;
    }),
    (worker) => Effect.promise(() => worker.close()),
  );
});
