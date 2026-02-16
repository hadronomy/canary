import { describe, it, expect, spyOn } from "bun:test";

import { FetchHttpClient } from "@effect/platform";
import { Effect, Layer, ConfigProvider } from "effect";

import {
  EmbeddingService,
  EmbeddingServiceTest,
  EmbeddingServiceLive,
  normalizeInput,
} from "~/services/embedding";

async function readJsonBodyFromFetchCall(call: readonly [unknown, unknown?]): Promise<unknown> {
  const [requestInput, requestInit] = call;

  if (requestInit && typeof requestInit === "object" && "body" in requestInit) {
    const body = requestInit.body;
    if (typeof body === "string") {
      return JSON.parse(body);
    }
    if (body instanceof Uint8Array) {
      return JSON.parse(new TextDecoder().decode(body));
    }
  }

  if (requestInput instanceof Request) {
    return requestInput.clone().json();
  }

  throw new Error("Unable to read JSON body from fetch call");
}

function readHeaderFromFetchCall(call: readonly [unknown, unknown?], name: string): string | null {
  const [requestInput, requestInit] = call;

  if (requestInput instanceof Request) {
    return requestInput.headers.get(name);
  }

  if (requestInit && typeof requestInit === "object" && "headers" in requestInit) {
    const headers = requestInit.headers;
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    if (Array.isArray(headers)) {
      const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
      return match ? match[1] : null;
    }
    if (headers && typeof headers === "object") {
      const record = headers as Record<string, string>;
      return record[name] ?? record[name.toLowerCase()] ?? null;
    }
  }

  return null;
}

describe("EmbeddingService", () => {
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
          model: "jina-embeddings-v4",
          data: [{ embedding: [0.1, 0.2], multi_vector: [[0.3, 0.4]], index: 0 }],
          usage: { total_tokens: 2, prompt_tokens: 2 },
        }),
      ),
    );

    const program = Effect.flatMap(EmbeddingService, (service) => service.embed("test"));

    const LiveEnv = EmbeddingServiceLive.pipe(
      Layer.provide(
        Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["JINA_API_KEY", "test-key"]]))),
      ),
      Layer.provide(FetchHttpClient.layer),
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(LiveEnv)));

    if (Array.isArray(result)) throw new Error("Expected single result");

    expect(mockFetch).toHaveBeenCalled();
    const lastCall = mockFetch.mock.calls.at(-1)!;
    expect(readHeaderFromFetchCall(lastCall, "Authorization")).toBe("Bearer test-key");
    expect(result.full).toEqual([0.1, 0.2]);
    expect(result.scout).toEqual([0.1, 0.2]);
    expect(result.multi).toEqual([[0.3, 0.4]]);

    mockFetch.mockRestore();
  });

  it("should embed text using Test layer", async () => {
    const program = Effect.flatMap(EmbeddingService, (service) => service.embed("hello world"));

    const runnable = Effect.provide(program, EmbeddingServiceTest);

    const result = await Effect.runPromise(runnable);

    if (Array.isArray(result)) throw new Error("Expected single result");

    expect(result.scout).toBeDefined();
    expect(result.full).toBeDefined();
    expect(result.multi).toBeDefined();
  });

  it("should rerank documents using Test layer", async () => {
    const program = Effect.flatMap(EmbeddingService, (service) =>
      service.rerank("query", ["doc1", "doc2"]),
    );

    const runnable = Effect.provide(program, EmbeddingServiceTest);

    const result = await Effect.runPromise(runnable);

    expect(result.length).toBe(2);
    expect(result[0]!.relevance_score).toBeGreaterThan(0);
  });

  it("should normalize mixed inputs correctly", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jina-embeddings-v4",
          data: [{ embedding: [0.1], index: 0 }],
          usage: { total_tokens: 1, prompt_tokens: 1 },
        }),
      ),
    );

    const inputs = ["https://example.com", "some text", new Uint8Array([1]), { text: "obj text" }];

    const program = Effect.flatMap(EmbeddingService, (service) => service.embed(inputs));

    const LiveEnv = EmbeddingServiceLive.pipe(
      Layer.provide(
        Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["JINA_API_KEY", "test-key"]]))),
      ),
      Layer.provide(FetchHttpClient.layer),
    );

    await Effect.runPromise(program.pipe(Effect.provide(LiveEnv)));

    expect(mockFetch).toHaveBeenCalled();
    const body = (await readJsonBodyFromFetchCall(mockFetch.mock.calls.at(-1)!)) as {
      readonly input: ReadonlyArray<unknown>;
    };
    const sentInputs = body.input;

    expect(sentInputs[0]).toEqual({ url: "https://example.com" });
    expect(sentInputs[1]).toEqual({ text: "some text" });
    expect(sentInputs[2]).toEqual({ image: "AQ==" });
    expect(sentInputs[3]).toEqual({ text: "obj text" });

    mockFetch.mockRestore();
  });

  it("should handle mixed input array", async () => {
    const mockFetch = spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jina-embeddings-v4",
          data: [{ embedding: [0.1], index: 0 }],
          usage: { total_tokens: 1, prompt_tokens: 1 },
        }),
      ),
    );

    const inputs = ["text", new Uint8Array([1, 2, 3]), { url: "https://example.com" }];

    const program = Effect.flatMap(EmbeddingService, (service) => service.embed(inputs));

    const LiveEnv = EmbeddingServiceLive.pipe(
      Layer.provide(
        Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["JINA_API_KEY", "test-key"]]))),
      ),
      Layer.provide(FetchHttpClient.layer),
    );

    await Effect.runPromise(program.pipe(Effect.provide(LiveEnv)));

    expect(mockFetch).toHaveBeenCalled();
    const body = (await readJsonBodyFromFetchCall(mockFetch.mock.calls.at(-1)!)) as {
      readonly input: ReadonlyArray<unknown>;
      readonly model: string;
    };

    expect(body.input).toHaveLength(3);
    expect(body.input[0]).toEqual({ text: "text" });
    expect(body.input[1]).toEqual({ image: Buffer.from([1, 2, 3]).toString("base64") });
    expect(body.input[2]).toEqual({ url: "https://example.com" });

    expect(body.model).toBe("jina-embeddings-v4");

    mockFetch.mockRestore();
  });
});
