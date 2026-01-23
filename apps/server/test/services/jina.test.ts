import { describe, it, expect, spyOn } from "bun:test";
import { Effect, Layer, ConfigProvider } from "effect";
import { JinaService, JinaServiceTest, JinaServiceLive } from "../../src/services/jina";

describe("JinaService", () => {
  it("should call API correctly in Live layer", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }],
        }),
      ),
    );

    const program = Effect.flatMap(JinaService, (service) => service.embed("test"));

    const LiveEnv = JinaServiceLive.pipe(
      Layer.provide(
        Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["JINA_API_KEY", "test-key"]]))),
      ),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(LiveEnv)));

    expect(mockFetch).toHaveBeenCalled();
    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(result.full).toEqual([0.1, 0.2]);

    mockFetch.mockRestore();
  });

  it("should embed text using Test layer", async () => {
    const program = Effect.flatMap(JinaService, (service) => service.embed("hello world"));

    const runnable = Effect.provide(program, JinaServiceTest);

    const result = await Effect.runPromise(runnable);

    expect(result.scout).toBeDefined();
    expect(result.full).toBeDefined();
    expect(result.multi).toBeDefined();
  });

  it("should rerank documents using Test layer", async () => {
    const program = Effect.flatMap(JinaService, (service) =>
      service.rerank("query", ["doc1", "doc2"]),
    );

    const runnable = Effect.provide(program, JinaServiceTest);

    const result = await Effect.runPromise(runnable);

    expect(result.length).toBe(2);
    expect(result[0].relevance_score).toBeGreaterThan(0);
  });
});
