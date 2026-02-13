// apps/server/src/services/collector/errors.ts
// Structured error types for the collector system

import { Schema } from "effect";

import { CollectorIdSchema, CollectionRunIdSchema, FactoryIdSchema } from "./schema";

export class CollectorNotFoundError extends Schema.TaggedError<CollectorNotFoundError>()(
  "CollectorNotFoundError",
  {
    collectorId: CollectorIdSchema,
    message: Schema.String,
  },
) {}

export class FactoryNotFoundError extends Schema.TaggedError<FactoryNotFoundError>()(
  "FactoryNotFoundError",
  {
    factoryId: FactoryIdSchema,
    message: Schema.String,
  },
) {}

export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  "ConfigValidationError",
  {
    collectorId: CollectorIdSchema,
    issues: Schema.Array(Schema.String),
    message: Schema.String,
  },
) {}

export class CollectionError extends Schema.TaggedError<CollectionError>()("CollectionError", {
  collectorId: CollectorIdSchema,
  runId: Schema.optional(CollectionRunIdSchema),
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect),
  message: Schema.String,
}) {}

export class SourceConnectionError extends Schema.TaggedError<SourceConnectionError>()(
  "SourceConnectionError",
  {
    collectorId: CollectorIdSchema,
    sourceUrl: Schema.String,
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class ScheduleError extends Schema.TaggedError<ScheduleError>()("ScheduleError", {
  collectorId: CollectorIdSchema,
  schedule: Schema.String,
  reason: Schema.String,
  message: Schema.String,
}) {}

export class ModeNotSupportedError extends Schema.TaggedError<ModeNotSupportedError>()(
  "ModeNotSupportedError",
  {
    collectorId: CollectorIdSchema,
    requestedMode: Schema.String,
    supportedModes: Schema.Array(Schema.String),
    message: Schema.String,
  },
) {}

export class ResumeError extends Schema.TaggedError<ResumeError>()("ResumeError", {
  collectorId: CollectorIdSchema,
  runId: CollectionRunIdSchema,
  reason: Schema.String,
  message: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  collectorId: CollectorIdSchema,
  field: Schema.String,
  value: Schema.Unknown,
  reason: Schema.String,
  message: Schema.String,
}) {}

export class HealthCheckError extends Schema.TaggedError<HealthCheckError>()("HealthCheckError", {
  collectorId: CollectorIdSchema,
  reason: Schema.String,
  message: Schema.String,
}) {}

export class CollectionStallError extends Schema.TaggedError<CollectionStallError>()(
  "CollectionStallError",
  {
    runId: CollectionRunIdSchema,
    durationMs: Schema.Number,
    message: Schema.String,
  },
) {}

export type CollectorError =
  | CollectorNotFoundError
  | FactoryNotFoundError
  | ConfigValidationError
  | CollectionError
  | SourceConnectionError
  | ScheduleError
  | ModeNotSupportedError
  | ResumeError
  | ValidationError
  | HealthCheckError;
