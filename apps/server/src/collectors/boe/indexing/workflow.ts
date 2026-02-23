import * as WorkflowEngine from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { BoeIndexingActivities } from "./activities";
import { BoeWorkflowEngineLayer } from "./engine";
import type { IndexingTriggerPayload } from "./schema";
import { BoeDocumentIndexWorkflow, BoeDocumentIndexWorkflowLayer } from "./workflow-definition";

export class BoeIndexingWorkflow extends Effect.Service<BoeIndexingWorkflow>()(
  "BoeIndexingWorkflow",
  {
    accessors: true,
    dependencies: [BoeWorkflowEngineLayer, BoeIndexingActivities.Default],
    scoped: Effect.gen(function* () {
      const workflowEngine = yield* WorkflowEngine.WorkflowEngine;
      const activities = yield* BoeIndexingActivities;

      const workflowContext = yield* Layer.build(
        BoeDocumentIndexWorkflowLayer.pipe(
          Layer.provideMerge(Layer.succeed(WorkflowEngine.WorkflowEngine, workflowEngine)),
          Layer.provideMerge(Layer.succeed(BoeIndexingActivities, activities)),
        ),
      );

      const start = Effect.fn("BoeIndexingWorkflow.start")((payload: IndexingTriggerPayload) =>
        BoeDocumentIndexWorkflow.execute(payload).pipe(Effect.provide(workflowContext)),
      );

      const startMany = Effect.fn("BoeIndexingWorkflow.startMany")(
        (payloads: ReadonlyArray<IndexingTriggerPayload>) =>
          Effect.forEach(payloads, start, {
            discard: true,
            concurrency: 1,
          }),
      );

      const resume = Effect.fn("BoeIndexingWorkflow.resume")((executionId: string) =>
        BoeDocumentIndexWorkflow.resume(executionId).pipe(Effect.provide(workflowContext)),
      );

      const poll = Effect.fn("BoeIndexingWorkflow.poll")((executionId: string) =>
        BoeDocumentIndexWorkflow.poll(executionId).pipe(Effect.provide(workflowContext)),
      );

      return {
        start,
        startMany,
        resume,
        poll,
      };
    }),
  },
) {}
