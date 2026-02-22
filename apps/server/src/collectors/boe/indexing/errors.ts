import { Schema } from "effect";

import { CollectionRunId, DocumentId, DocumentVersionId } from "./schema";

export class IndexingWorkflowUnavailableError extends Schema.TaggedError<IndexingWorkflowUnavailableError>()(
  "IndexingWorkflowUnavailableError",
  {
    versionId: DocumentVersionId,
    message: Schema.String,
  },
) {}

export class IndexingEnqueueError extends Schema.TaggedError<IndexingEnqueueError>()(
  "IndexingEnqueueError",
  {
    versionId: DocumentVersionId,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class IndexingWorkflowError extends Schema.TaggedError<IndexingWorkflowError>()(
  "IndexingWorkflowError",
  {
    runId: CollectionRunId,
    docId: DocumentId,
    versionId: DocumentVersionId,
    executionId: Schema.String,
    stage: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
