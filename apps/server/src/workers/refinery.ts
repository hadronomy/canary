import { Effect, Console } from "effect";
import { Queues } from "../queues/index.js";
import { makeWorker } from "../services/queue.js";

export const RefineryWorker = makeWorker(Queues.refinery, (job) =>
  Effect.gen(function* () {
    yield* Console.log(`Processing job ${job.id}: ${job.name}`);
    yield* Effect.sleep("1 second");
    yield* Console.log(`Job ${job.id} completed`);
  }),
);
