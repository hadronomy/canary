import { Schema } from "effect";

export const UnknownRangeStrategy = Schema.Literal("fail", "regulation");

export class BoeCollectorConfig extends Schema.Class<BoeCollectorConfig>("BoeCollectorConfig")({
  sourceId: Schema.UUID,
  baseUrl: Schema.optionalWith(Schema.String.pipe(Schema.pattern(/^https?:\/\//)), {
    default: () => "https://boe.es/datosabiertos/api/legislacion-consolidada",
  }),
  batchSize: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.positive()), {
    default: () => 250,
  }),
  timeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), {
    default: () => 30000,
  }),
  requestDelayMs: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 300,
  }),
  ingestTextVersions: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  textRequestTimeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), {
    default: () => 45000,
  }),
  trackSyncRuns: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  unknownRangeStrategy: Schema.optionalWith(UnknownRangeStrategy, {
    default: () => "regulation",
  }),
  upsertActor: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => "collector:boe-laws",
  }),
  staticQuery: Schema.optionalWith(Schema.String, {
    default: () => "",
  }),
}) {}
