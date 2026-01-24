import { Context, Effect, Layer, Schema, Config } from "effect";
import { XMLParser } from "fast-xml-parser";

export class BocItem extends Schema.Class<BocItem>("BocItem")({
  title: Schema.String,
  link: Schema.String,
  pubDate: Schema.String,
  guid: Schema.String,
}) {}

export class BocError extends Schema.TaggedError<BocError>()("BocError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class BocService extends Context.Tag("BocService")<
  BocService,
  {
    readonly fetchFeed: () => Effect.Effect<readonly BocItem[], BocError>;
    readonly parseFeed: (xml: string) => Effect.Effect<readonly BocItem[], BocError>;
  }
>() {
  static readonly Live = Layer.effect(
    BocService,
    Effect.gen(function* () {
      const feedUrl = yield* Config.string("BOC_FEED_URL").pipe(
        Config.withDefault("http://www.gobiernodecanarias.org/boc/rss/boc.xml"),
      );

      const parser = new XMLParser({
        ignoreAttributes: false,
        isArray: (name) => name === "item",
      });

      const parseFeed = (xml: string) =>
        Effect.try({
          try: () => {
            const result = parser.parse(xml);
            const channel = result?.rss?.channel;

            if (!channel || !channel.item) {
              return [];
            }

            const itemsArray = Array.isArray(channel.item) ? channel.item : [channel.item];

            return itemsArray.map((item: any) => {
              const guid =
                typeof item.guid === "object" && item.guid !== null && "#text" in item.guid
                  ? item.guid["#text"]
                  : item.guid;

              return new BocItem({
                title: String(item.title ?? ""),
                link: String(item.link ?? ""),
                pubDate: String(item.pubDate ?? ""),
                guid: String(guid ?? ""),
              });
            });
          },
          catch: (error) => new BocError({ message: "Failed to parse BOC feed", cause: error }),
        });

      const fetchFeed = () =>
        Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () => fetch(feedUrl),
            catch: (error) => new BocError({ message: "Network Error", cause: error }),
          });

          if (!response.ok) {
            return yield* Effect.fail(
              new BocError({
                message: `Failed to fetch feed: ${response.status} ${response.statusText}`,
              }),
            );
          }

          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (error) =>
              new BocError({ message: "Failed to read response text", cause: error }),
          });

          return yield* parseFeed(text);
        });

      return { fetchFeed, parseFeed };
    }),
  );
}
