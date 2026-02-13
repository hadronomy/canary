import { Schema } from "effect";

import {
  CollectionProgress,
  CollectionRunIdSchema,
  CollectionStats,
  CollectorIdSchema,
} from "./schema";

export const CollectorEventBase = {
  runId: CollectionRunIdSchema,
  collectorId: CollectorIdSchema,
  timestamp: Schema.DateTimeUtc,
};

export const ProgressEvent = Schema.TaggedStruct("Progress", {
  ...CollectorEventBase,
  progress: CollectionProgress,
}).pipe(Schema.annotations({ identifier: "ProgressEvent" }));

export type ProgressEvent = typeof ProgressEvent.Type;

export const CompletedEvent = Schema.TaggedStruct("Completed", {
  ...CollectorEventBase,
  stats: CollectionStats,
}).pipe(Schema.annotations({ identifier: "CompletedEvent" }));

export type CompletedEvent = typeof CompletedEvent.Type;

export class FailedEvent extends Schema.TaggedError<FailedEvent>()("Failed", {
  ...CollectorEventBase,
  error: Schema.String,
  retryable: Schema.Boolean,
  progress: Schema.optionalWith(CollectionProgress, { as: "Option" }),
}) {}

export class CancelledEvent extends Schema.TaggedError<CancelledEvent>()("Cancelled", {
  ...CollectorEventBase,
  reason: Schema.optional(Schema.String),
  progress: Schema.optionalWith(CollectionProgress, { as: "Option" }),
}) {}

export const CollectorEvent = Schema.Union(
  ProgressEvent,
  CompletedEvent,
  FailedEvent,
  CancelledEvent,
);

export type CollectorEvent = typeof CollectorEvent.Type;

export const isProgressEvent = (event: CollectorEvent): event is ProgressEvent =>
  event._tag === "Progress";

export const isCompletedEvent = (event: CollectorEvent): event is CompletedEvent =>
  event._tag === "Completed";

export const isFailedEvent = (event: CollectorEvent): event is FailedEvent =>
  event._tag === "Failed";

export const isCancelledEvent = (event: CollectorEvent): event is CancelledEvent =>
  event._tag === "Cancelled";

export const isTerminalEvent = (event: CollectorEvent): boolean =>
  event._tag === "Completed" || event._tag === "Failed" || event._tag === "Cancelled";
