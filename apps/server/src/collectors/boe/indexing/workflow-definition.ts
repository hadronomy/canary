import { Activity, Workflow } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { BoeIndexingActivities } from "./activities";
import { IndexingWorkflowError } from "./errors";
import { IndexingTriggerPayload } from "./schema";

export const BoeDocumentIndexWorkflow = Workflow.make({
  name: "BoeDocumentIndexWorkflow",
  payload: IndexingTriggerPayload.fields,
  success: Schema.Void,
  error: IndexingWorkflowError,
  idempotencyKey: (payload) => `${payload.versionId}:${payload.contentHash ?? "none"}`,
});

export const BoeDocumentIndexWorkflowLayer = BoeDocumentIndexWorkflow.toLayer(
  Effect.fn("BoeDocumentIndexWorkflow.execute")(function* (payload, executionId) {
    const activities = yield* BoeIndexingActivities;

    yield* activities.markInProgress(payload, executionId);

    const retryTransient = Activity.retry({ times: 4 });

    const VersionDataSchema = Schema.Struct({
      contentText: Schema.String,
      validFrom: Schema.DateFromSelf,
      validUntil: Schema.NullOr(Schema.DateFromSelf),
    });

    const run = Effect.gen(function* () {
      yield* Activity.make({
        name: "BoeIndexing.EnsureLatestVersion",
        success: Schema.Void,
        error: IndexingWorkflowError,
        execute: activities.ensureLatestVersion(payload, executionId),
      }).pipe(retryTransient);

      const versionData = yield* Activity.make({
        name: "BoeIndexing.LoadVersionContent",
        success: VersionDataSchema,
        error: IndexingWorkflowError,
        execute: activities.loadVersionContent(payload, executionId),
      }).pipe(retryTransient);

      yield* Activity.make({
        name: "BoeIndexing.ProcessFragments",
        success: Schema.Void,
        error: IndexingWorkflowError,
        execute: activities.processFragments(payload, executionId, versionData),
      }).pipe(retryTransient);

      yield* Activity.make({
        name: "BoeIndexing.FinalizeReady",
        success: Schema.Void,
        error: IndexingWorkflowError,
        execute: activities.finalizeReady(payload, executionId),
      }).pipe(retryTransient);
    });

    return yield* run.pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        cause instanceof IndexingWorkflowError
          ? cause
          : new IndexingWorkflowError({
              runId: payload.runId,
              docId: payload.docId,
              versionId: payload.versionId,
              executionId,
              stage: "workflow",
              message: "Unhandled indexing workflow failure",
              cause,
            }),
      ),
      Effect.tapError((error) =>
        activities.finalizeFailed(
          payload,
          `[${error.stage}] ${error.message}${error.cause === undefined ? "" : `: ${String(error.cause)}`}`,
        ),
      ),
    );
  }),
);
