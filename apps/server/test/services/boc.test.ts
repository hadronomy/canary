import { describe, it, expect, spyOn } from "bun:test";
import { Effect, Layer, ConfigProvider } from "effect";
import { BocService, BocServiceLive } from "../../src/services/boc";

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

    const TestEnv = BocServiceLive.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: "Title 1",
      link: "http://link1.com",
      pubDate: "Mon, 01 Jan 2024 10:00:00 GMT",
      guid: "guid1",
    });
    expect(result[1]).toEqual({
      title: "Title 2",
      link: "http://link2.com",
      pubDate: "Mon, 01 Jan 2024 11:00:00 GMT",
      guid: "guid2",
    });
  });

  it("should fetch and parse feed", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(new Response(sampleXml));

    const program = Effect.flatMap(BocService, (service) => service.fetchFeed());

    const TestEnv = BocServiceLive.pipe(
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

    const TestEnv = BocServiceLive.pipe(
      Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(TestEnv)));
    expect(result).toEqual([]);
  });
});
