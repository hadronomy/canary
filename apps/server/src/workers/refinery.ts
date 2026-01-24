import { Console, Effect } from "effect";

import { Queues } from "~/queues/index";
import { JinaService } from "~/services/jina";
import { makeWorker } from "~/services/queue";

export const RefineryWorker = makeWorker(Queues.refinery, (job) =>
  Effect.gen(function* () {
    yield* Console.log(`Processing BOC item ${job.id}: ${job.data.title}`);

    const jina = yield* JinaService;

    const content = `Mock content for ${job.data.title}`;

    const embeddings = yield* jina.embed(content);

    if (Array.isArray(embeddings)) {
      yield* Console.log(`Generated embeddings for ${job.data.title}`);
    } else {
      yield* Console.log(`Generated embedding for ${job.data.title}`);
    }

    yield* Effect.sleep("1 second");
    yield* Console.log(`BOC item ${job.data.guid} processed and indexed`);
  }),
);
