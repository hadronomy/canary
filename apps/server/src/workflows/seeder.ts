import { Context, Effect, Layer, Schema } from "effect";

import { Queues } from "~/queues/index";
import { BocItem } from "~/services/boc";
import { QueueError, QueueService } from "~/services/queue";

export class BocArchiveError extends Schema.TaggedError<BocArchiveError>()("BocArchiveError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class BocArchiveService extends Context.Tag("@canary/BocArchiveService")<
  BocArchiveService,
  {
    readonly fetchRange: (
      startYear: number,
      endYear: number,
    ) => Effect.Effect<readonly BocItem[], BocArchiveError>;
  }
>() {
  static readonly Live = Layer.effect(
    BocArchiveService,
    Effect.gen(function* () {
      const baseUrl = "https://www.gobiernodecanarias.org";

      const fetchYear = Effect.fn("BocArchiveService.fetchYear")(function* (year: number) {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`${baseUrl}/boc/archivo/${year}/`),
          catch: (e) => new BocArchiveError({ message: `Failed to fetch year ${year}`, cause: e }),
        });

        if (!response.ok) {
          return yield* new BocArchiveError({
            message: `Failed to fetch year ${year}: ${response.status}`,
          });
        }

        const html = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (e) =>
            new BocArchiveError({ message: `Failed to read year ${year} text`, cause: e }),
        });

        const bulletinMatches = html.matchAll(/\/boc\/\d{4}\/\d{3}\/index\.html/g);
        const urls = [...new Set([...bulletinMatches].map((m) => m[0]))];

        return urls;
      });

      const fetchBulletin = Effect.fn("BocArchiveService.fetchBulletin")(function* (
        bulletinPath: string,
      ) {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`${baseUrl}${bulletinPath}`),
          catch: (e) =>
            new BocArchiveError({
              message: `Failed to fetch bulletin ${bulletinPath}`,
              cause: e,
            }),
        });

        if (!response.ok) {
          return yield* new BocArchiveError({
            message: `Failed to fetch bulletin ${bulletinPath}: ${response.status}`,
          });
        }

        const html = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (e) =>
            new BocArchiveError({
              message: `Failed to read bulletin ${bulletinPath} text`,
              cause: e,
            }),
        });

        const itemMatches = html.matchAll(
          /https:\/\/sede\.gobiernodecanarias\.org\/boc\/boc-a-\d{4}-\d{3}-\d+\.pdf/g,
        );
        const pdfUrls = [...new Set([...itemMatches].map((m) => m[0]))];

        const items: BocItem[] = pdfUrls.map((url) => {
          const id = url.split("/").pop()?.replace(".pdf", "") ?? "unknown";
          return new BocItem({
            title: `Historical Item ${id}`,
            link: url,
            pubDate: "unknown",
            guid: id,
          });
        });

        return items;
      });

      const fetchRange = Effect.fn("BocArchiveService.fetchRange")(function* (
        startYear: number,
        endYear: number,
      ) {
        const years = Array.from(
          { length: endYear - startYear + 1 },
          (_, i) => startYear + i,
        ).reverse();

        const allItems: BocItem[] = [];

        for (const year of years) {
          const bulletinPaths = yield* fetchYear(year);
          const items = yield* Effect.forEach(bulletinPaths, (path) => fetchBulletin(path), {
            concurrency: 10,
          });
          allItems.push(...items.flat());
        }

        return allItems;
      });

      return { fetchRange };
    }),
  );
}

export class SeederWorkflow extends Context.Tag("@canary/SeederWorkflow")<
  SeederWorkflow,
  {
    readonly runSeeder: (options: {
      startYear: number;
      endYear: number;
    }) => Effect.Effect<void, QueueError | BocArchiveError>;
  }
>() {
  static readonly Live = Layer.effect(
    SeederWorkflow,
    Effect.gen(function* () {
      const bocArchiveService = yield* BocArchiveService;
      const queueService = yield* QueueService;

      const runSeeder = Effect.fn("SeederWorkflow.runSeeder")(function* (options: {
        startYear: number;
        endYear: number;
      }) {
        const items = yield* bocArchiveService.fetchRange(options.startYear, options.endYear);

        yield* Effect.logInfo(`Seeder fetched ${items.length} items`);

        yield* Effect.forEach(items, (item) => queueService.add(Queues.refinery, item), {
          concurrency: 5,
        });

        yield* Effect.logInfo(`Seeder queued ${items.length} items`);
      });

      return {
        runSeeder: (options) => runSeeder(options),
      };
    }),
  );
}
