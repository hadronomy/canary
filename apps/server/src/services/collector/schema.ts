// apps/server/src/services/collector/schema.ts
// Domain schema types for the collector system

import { Brand, Data, Duration, Option, type Option as OptionType } from "effect";
import { Schema } from "effect";

// ─── Branded IDs ─────────────────────────────────────────────────────────────

export type CollectorId = string & Brand.Brand<"CollectorId">;
export const CollectorId = Brand.nominal<CollectorId>();

export type FactoryId = string & Brand.Brand<"FactoryId">;
export const FactoryId = Brand.nominal<FactoryId>();

export type CollectionRunId = string & Brand.Brand<"CollectionRunId">;
export const CollectionRunId = Brand.nominal<CollectionRunId>();

export const CollectorIdSchema = Schema.String.pipe(Schema.fromBrand(CollectorId));
export const FactoryIdSchema = Schema.String.pipe(Schema.fromBrand(FactoryId));
export const CollectionRunIdSchema = Schema.String.pipe(Schema.fromBrand(CollectionRunId));

// ─── Capability ──────────────────────────────────────────────────────────────

export const Capability = Schema.Literal(
  "FullSync",
  "Incremental",
  "Backfill",
  "Validation",
  "Continuous",
  "Resume",
  "ChangeDetection",
);

export type Capability = typeof Capability.Type;

/** Capabilities stored as a ReadonlySet for O(1) lookups and type safety */
export type Capabilities = ReadonlySet<Capability>;

/** Check if capabilities include a specific capability */
export const hasCapability = (caps: Capabilities, cap: Capability): boolean => caps.has(cap);

/** Assert capability presence, returning an error if missing */
export const assertCapability = (
  caps: Capabilities,
  cap: Capability,
  collectorId: string,
): OptionType.Option<{ collectorId: string; requestedMode: string; supportedModes: string[] }> => {
  if (caps.has(cap)) {
    return Option.none();
  }
  return Option.some({
    collectorId,
    requestedMode: cap,
    supportedModes: Array.from(caps),
  });
};

// ─── Document Kind ───────────────────────────────────────────────────────────

export type DocumentKind = Data.TaggedEnum<{
  readonly New: {};
  readonly Update: { readonly previousHash: string };
  readonly Unchanged: { readonly hash: string };
}>;

export const DocumentKind = Data.taggedEnum<DocumentKind>();

// ─── Collection Mode ─────────────────────────────────────────────────────────

export type CollectionMode = Data.TaggedEnum<{
  readonly FullSync: {
    readonly startDate?: Date;
    readonly batchSize?: number;
  };
  readonly Incremental: {
    readonly since: Date;
    readonly lookBackWindow?: Duration.Duration;
  };
  readonly Backfill: {
    readonly from: Date;
    readonly to: Date;
    readonly batchSize?: number;
  };
  readonly Validation: {
    readonly from?: Date;
    readonly to?: Date;
    readonly strategy: ValidationStrategy;
  };
  readonly Resume: {
    readonly originalMode: CollectionMode;
    readonly cursor: string;
    readonly runId: string;
  };
  readonly Continuous: {
    readonly bufferSize?: number;
  };
}>;

type CollectionModeEncoded = Data.TaggedEnum<{
  readonly FullSync: {
    readonly startDate?: Date;
    readonly batchSize?: number;
  };
  readonly Incremental: {
    readonly since: Date;
    readonly lookBackWindow?: number;
  };
  readonly Backfill: {
    readonly from: Date;
    readonly to: Date;
    readonly batchSize?: number;
  };
  readonly Validation: {
    readonly from?: Date;
    readonly to?: Date;
    readonly strategy: ValidationStrategy;
  };
  readonly Resume: {
    readonly originalMode: CollectionModeEncoded;
    readonly cursor: string;
    readonly runId: string;
  };
  readonly Continuous: {
    readonly bufferSize?: number;
  };
}>;

export const CollectionMode = Data.taggedEnum<CollectionMode>();

export type ValidationStrategy = Data.TaggedEnum<{
  readonly CheckOnly: {};
  readonly RefetchInvalid: {};
  readonly RefetchAll: {};
}>;

export const ValidationStrategy = Data.taggedEnum<ValidationStrategy>();

// ─── Schema Versions for Persistence ─────────────────────────────────────────

export const ValidationStrategySchema = Schema.Union(
  Schema.TaggedStruct("CheckOnly", {}),
  Schema.TaggedStruct("RefetchInvalid", {}),
  Schema.TaggedStruct("RefetchAll", {}),
);

export const CollectionModeSchema: Schema.Schema<CollectionMode, CollectionModeEncoded> =
  Schema.suspend(() =>
    Schema.Union(
      Schema.TaggedStruct("FullSync", {
        startDate: Schema.optional(Schema.DateFromSelf),
        batchSize: Schema.optional(Schema.Number),
      }),
      Schema.TaggedStruct("Incremental", {
        since: Schema.DateFromSelf,
        lookBackWindow: Schema.optional(Schema.DurationFromMillis),
      }),
      Schema.TaggedStruct("Backfill", {
        from: Schema.DateFromSelf,
        to: Schema.DateFromSelf,
        batchSize: Schema.optional(Schema.Number),
      }),
      Schema.TaggedStruct("Validation", {
        from: Schema.optional(Schema.DateFromSelf),
        to: Schema.optional(Schema.DateFromSelf),
        strategy: ValidationStrategySchema,
      }),
      Schema.TaggedStruct("Resume", {
        originalMode: CollectionModeSchema,
        cursor: Schema.String,
        runId: Schema.String,
      }),
      Schema.TaggedStruct("Continuous", {
        bufferSize: Schema.optional(Schema.Number),
      }),
    ).pipe(Schema.annotations({ identifier: "CollectionMode" })),
  );

// ─── Collected Document ──────────────────────────────────────────────────────

export class CollectedDocument extends Schema.Class<CollectedDocument>("CollectedDocument")({
  externalId: Schema.String,
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  publishedAt: Schema.DateTimeUtc,
  updatedAt: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
  sourceUrl: Schema.optionalWith(Schema.String, { as: "Option" }),
  contentHash: Schema.optionalWith(Schema.String, { as: "Option" }),
  kind: Schema.Literal("New", "Update", "Unchanged"),
}) {}

// ─── Collection Cursor ───────────────────────────────────────────────────────

export class CollectionCursor extends Schema.Class<CollectionCursor>("CollectionCursor")({
  value: Schema.String,
  displayLabel: Schema.optionalWith(Schema.String, { as: "Option" }),
}) {}

// ─── Collection Batch ────────────────────────────────────────────────────────

export class CollectionBatch extends Schema.Class<CollectionBatch>("CollectionBatch")({
  documents: Schema.Array(CollectedDocument),
  cursor: Schema.optionalWith(CollectionCursor, { as: "Option" }),
  hasMore: Schema.Boolean,
}) {}

// ─── Collection Progress ─────────────────────────────────────────────────────

export class CollectionProgress extends Schema.Class<CollectionProgress>("CollectionProgress")({
  runId: CollectionRunIdSchema,
  collectorId: CollectorIdSchema,
  mode: CollectionModeSchema,
  cursor: Schema.optionalWith(CollectionCursor, { as: "Option" }),
  processed: Schema.Number,
  inserted: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  startedAt: Schema.DateTimeUtc,
  lastProgressAt: Schema.DateTimeUtc,
  estimatedTotal: Schema.optionalWith(Schema.Number, { as: "Option" }),
  estimatedCompletion: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
}) {}

// ─── Collection Stats ────────────────────────────────────────────────────────

export class CollectionStats extends Schema.Class<CollectionStats>("CollectionStats")({
  processed: Schema.Number,
  inserted: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  duration: Schema.DurationFromMillis,
}) {}

// ─── Collection Run Status ───────────────────────────────────────────────────

export type CollectionRunStatus = Data.TaggedEnum<{
  readonly Queued: {};
  readonly Running: { readonly progress: CollectionProgress };
  readonly Completed: { readonly stats: CollectionStats };
  readonly Failed: {
    readonly error: string;
    readonly progress: CollectionProgress | undefined;
    readonly retryable: boolean;
  };
  readonly Cancelled: {
    readonly reason: string | undefined;
    readonly progress: CollectionProgress | undefined;
  };
}>;

export const CollectionRunStatus = Data.taggedEnum<CollectionRunStatus>();

export const CollectionRunStatusSchema = Schema.Union(
  Schema.TaggedStruct("Queued", {}),
  Schema.TaggedStruct("Running", {
    progress: CollectionProgress,
  }),
  Schema.TaggedStruct("Completed", {
    stats: CollectionStats,
  }),
  Schema.TaggedStruct("Failed", {
    error: Schema.String,
    progress: Schema.Union(CollectionProgress, Schema.Undefined),
    retryable: Schema.Boolean,
  }),
  Schema.TaggedStruct("Cancelled", {
    reason: Schema.Union(Schema.String, Schema.Undefined),
    progress: Schema.Union(CollectionProgress, Schema.Undefined),
  }),
);

// ─── Collection Run ──────────────────────────────────────────────────────────

export class CollectionRun extends Schema.Class<CollectionRun>("CollectionRun")({
  runId: CollectionRunIdSchema,
  collectorId: CollectorIdSchema,
  mode: CollectionModeSchema,
  status: CollectionRunStatusSchema,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  completedAt: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
}) {}

// ─── Collection State ────────────────────────────────────────────────────────

export class CollectionState extends Schema.Class<CollectionState>("CollectionState")({
  collectorId: CollectorIdSchema,
  lastFullSync: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
  lastIncremental: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
  lastCursor: Schema.optionalWith(CollectionCursor, { as: "Option" }),
  totalDocumentsCollected: Schema.Number,
  lastDocumentDate: Schema.optionalWith(Schema.DateTimeUtc, { as: "Option" }),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  updatedAt: Schema.DateTimeUtc,
}) {}

// ─── Collector Entry (DB row) ─────────────────────────────────────────────────

export class CollectorEntry extends Schema.Class<CollectorEntry>("CollectorEntry")({
  collectorId: CollectorIdSchema,
  factoryId: FactoryIdSchema,
  name: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.optionalWith(Schema.String, { as: "Option" }),
  enabled: Schema.Boolean,
  schedule: Schema.String.pipe(Schema.minLength(1)), // cron
  defaultMode: CollectionModeSchema,
  config: Schema.Unknown,
  state: Schema.optionalWith(CollectionState, { as: "Option" }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}
