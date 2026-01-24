import { describe, it, expect, spyOn } from "bun:test";
import { Effect, Layer, ConfigProvider } from "effect";
import { BocService } from "../../src/services/boc";

const sampleXml = `
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Boletín Oficial de Canarias</title>
  <link>http://www.gobiernodecanarias.org/boc/</link>
  <description>Boletín Oficial de Canarias</description>
  <item>
    <title>Title 1</title>
    <link>http://link1.com</link>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <guid isPermaLink="true">guid1</guid>
  </item>
  <item>
    <title>Title 2</title>
    <link>http://link2.com</link>
    <pubDate>Mon, 01 Jan 2024 11:00:00 GMT</pubDate>
    <guid>guid2</guid>
  </item>
</channel>
</rss>
`;

describe("BocService", () => {
  it("should parse feed correctly", async () => {
    const program = Effect.flatMap(BocService, (service) => service.parseFeed(sampleXml));

    const TestEnv = BocService.Live.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      title: "Title 1",
      link: "http://link1.com",
      pubDate: "Mon, 01 Jan 2024 10:00:00 GMT",
      guid: "guid1",
    });
    expect(result[1]).toMatchObject({
      title: "Title 2",
      link: "http://link2.com",
      pubDate: "Mon, 01 Jan 2024 11:00:00 GMT",
      guid: "guid2",
    });
  });

  it("should fetch and parse feed", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(new Response(sampleXml));

    const program = Effect.flatMap(BocService, (service) => service.fetchFeed());

    const TestEnv = BocService.Live.pipe(
      Layer.provide(
        Layer.setConfigProvider(
          ConfigProvider.fromMap(new Map([["BOC_FEED_URL", "http://test-url.com"]])),
        ),
      ),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));

    expect(mockFetch).toHaveBeenCalledWith("http://test-url.com");
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("Title 1");

    mockFetch.mockRestore();
  });

  it("should handle empty feed", async () => {
    const emptyXml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
        <channel>
        </channel>
        </rss>
        `;

    const program = Effect.flatMap(BocService, (service) => service.parseFeed(emptyXml));

    const TestEnv = BocService.Live.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));
    expect(result).toEqual([]);
  });

  it("should filter out items with missing required fields", async () => {
    const invalidXml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
        <channel>
          <title>Boletín Oficial de Canarias</title>
          <item>
            <title>Valid Item</title>
            <link>http://link1.com</link>
            <guid>guid1</guid>
            <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
          </item>
          <item>
            <link>http://link2.com</link>
            <guid>guid2</guid>
            <pubDate>Mon, 01 Jan 2024 11:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Missing Link</title>
            <guid>guid3</guid>
            <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Missing Guid</title>
            <link>http://link4.com</link>
            <pubDate>Mon, 01 Jan 2024 13:00:00 GMT</pubDate>
          </item>
        </channel>
        </rss>
        `;

    const program = Effect.flatMap(BocService, (service) => service.parseFeed(invalidXml));

    const TestEnv = BocService.Live.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Valid Item",
      link: "http://link1.com",
      guid: "guid1",
    });
  });
});
