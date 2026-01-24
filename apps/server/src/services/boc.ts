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
        Effect.gen(function* () {
          const itemsArray = yield* Effect.try({
            try: () => {
              const result = parser.parse(xml);
              const channel = result?.rss?.channel;

              if (!channel || !channel.item) {
                return [];
              }

              return Array.isArray(channel.item) ? channel.item : [channel.item];
            },
            catch: (error) => new BocError({ message: "Failed to parse BOC feed", cause: error }),
          });

          const validItems: BocItem[] = [];

          for (const item of itemsArray) {
            const guid =
              typeof item.guid === "object" && item.guid !== null && "#text" in item.guid
                ? item.guid["#text"]
                : item.guid;

            const title = item.title;
            const link = item.link;

            if (!guid || !title || !link) {
              yield* Effect.logWarning("Skipping invalid BOC item", { guid, title, link });
              continue;
            }

            validItems.push(
              new BocItem({
                title: String(title),
                link: String(link),
                pubDate: String(item.pubDate ?? ""),
                guid: String(guid),
              }),
            );
          }

          return validItems;
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
