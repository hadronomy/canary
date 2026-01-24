import { Context, Data, Effect, Layer, Config } from "effect";
import { XMLParser } from "fast-xml-parser";

export class BocError extends Data.TaggedError("BocError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface BocItem {
  readonly title: string;
  readonly link: string;
  readonly pubDate: string;
  readonly guid: string;
}

export class BocService extends Context.Tag("BocService")<
  BocService,
  {
    readonly fetchFeed: () => Effect.Effect<BocItem[], BocError>;
    readonly parseFeed: (xml: string) => Effect.Effect<BocItem[], BocError>;
  }
>() {}

export const BocServiceLive = Layer.effect(
  BocService,
  Effect.gen(function* () {
    const feedUrl = yield* Config.string("BOC_FEED_URL").pipe(
      Config.withDefault("http://www.gobiernodecanarias.org/boc/rss/boc.xml"),
    );

    const parser = new XMLParser({
      ignoreAttributes: false,
      isArray: (name: string) => name === "item",
    });

    const parseFeed = (xml: string) =>
      Effect.try({
        try: () => {
          const result = parser.parse(xml);
          const channel = result?.rss?.channel;

          if (!channel || !channel.item) {
            return [];
          }

          return channel.item.map((item: any) => {
            let guid = item.guid;
            if (typeof guid === "object" && guid !== null && "#text" in guid) {
              guid = guid["#text"];
            }

            return {
              title: item.title,
              link: item.link,
              pubDate: item.pubDate,
              guid: String(guid),
            };
          });
        },
        catch: (e) => new BocError({ message: "Failed to parse XML", cause: e }),
      });

    const fetchFeed = () =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(feedUrl),
          catch: (e) => new BocError({ message: "Network Error", cause: e }),
        });

        if (!response.ok) {
          return yield* Effect.fail(
            new BocError({ message: `Fetch Error: ${response.status} ${response.statusText}` }),
          );
        }

        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (e) => new BocError({ message: "Failed to read response text", cause: e }),
        });

        return yield* parseFeed(text);
      });

    return {
      fetchFeed,
      parseFeed,
    };
  }),
);
