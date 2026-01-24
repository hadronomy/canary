import { describe, it, expect, spyOn } from "bun:test";
import { Effect, Layer, ConfigProvider } from "effect";
import {
  JinaService,
  JinaServiceTest,
  JinaServiceLive,
  normalizeInput,
} from "../../src/services/jina";

describe("JinaService", () => {
  describe("normalizeInput", () => {
    it("should normalize plain text", async () => {
      const result = await Effect.runPromise(normalizeInput("hello world"));
      expect(result).toEqual({ text: "hello world" });
    });

    it("should normalize URL string", async () => {
      const url = "https://example.com/image.png";
      const result = await Effect.runPromise(normalizeInput(url));
      expect(result).toEqual({ url });
    });

    it("should normalize Uint8Array to base64 image", async () => {
      const buffer = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = Buffer.from(buffer).toString("base64");
      const result = await Effect.runPromise(normalizeInput(buffer));
      expect(result).toEqual({ image: base64 });
    });

    it("should normalize Blob to base64 image", async () => {
      const blob = new Blob(["Hello"]);
      const base64 = Buffer.from("Hello").toString("base64");
      const result = await Effect.runPromise(normalizeInput(blob));
      expect(result).toEqual({ image: base64 });
    });

    it("should pass through object with text", async () => {
      const input = { text: "hello" };
      const result = await Effect.runPromise(normalizeInput(input));
      expect(result).toEqual(input);
    });

    it("should normalize nested Uint8Array in object", async () => {
      const buffer = new Uint8Array([72, 101, 108, 108, 111]);
      const base64 = Buffer.from(buffer).toString("base64");
      const input = { image: buffer };
      const result = await Effect.runPromise(normalizeInput(input));
      expect(result).toEqual({ image: base64 });
    });
  });

  it("should call API correctly in Live layer", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2], multi_vector: [[0.3, 0.4]] }],
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
    const headers = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(result.full).toEqual([0.1, 0.2]);
    expect(result.scout).toEqual([0.1, 0.2]);
    expect(result.multi).toEqual([[0.3, 0.4]]);

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
    expect(result[0]!.relevance_score).toBeGreaterThan(0);
  });
});
