import { Schema } from "effect";

export class RssCollectorConfig extends Schema.Class<RssCollectorConfig>("RssCollectorConfig")({
  feedUrl: Schema.String.pipe(
    Schema.pattern(/^https?:\/\//),
    Schema.annotations({ description: "RSS feed URL" }),
  ),
  selectors: Schema.optionalWith(
    Schema.Struct({
      item: Schema.String,
      title: Schema.String,
      content: Schema.String,
      date: Schema.String,
      link: Schema.String,
    }),
    {
      default: () => ({
        item: "item",
        title: "title",
        content: "description",
        date: "pubDate",
        link: "link",
      }),
    },
  ),
  filterByCategory: Schema.optionalWith(Schema.Array(Schema.NonEmptyString), { default: () => [] }),
  pagination: Schema.optional(Schema.Struct({ pageParam: Schema.NonEmptyString })),
  batchSize: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.positive()), {
    default: () => 50,
  }),
  timeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), { default: () => 30000 }),
  requestDelayMs: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 1000,
  }),
}) {}
