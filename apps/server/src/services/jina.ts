import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Context, Data, Effect, Layer, Config, Redacted, Schema } from "effect";

export class JinaError extends Data.TaggedError("JinaError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface EmbeddedResult {
  readonly scout?: number[];
  readonly full?: number[];
  readonly multi?: number[][];
}

export interface RerankResult {
  readonly index: number;
  readonly relevance_score: number;
  readonly document?: {
    readonly text: string;
  };
}

const JinaEmbeddingItemSchema = Schema.Struct({
  embedding: Schema.Array(Schema.Number),
  multi_vector: Schema.optional(Schema.Array(Schema.Array(Schema.Number))),
  index: Schema.Number,
});

const JinaEmbeddingResponseSchema = Schema.Struct({
  model: Schema.String,
  data: Schema.Array(JinaEmbeddingItemSchema),
  usage: Schema.Struct({
    total_tokens: Schema.Number,
    prompt_tokens: Schema.Number,
  }),
});

const JinaRerankItemSchema = Schema.Struct({
  index: Schema.Number,
  relevance_score: Schema.Number,
  document: Schema.Struct({
    text: Schema.String,
  }),
});

const JinaRerankResponseSchema = Schema.Struct({
  model: Schema.String,
  results: Schema.Array(JinaRerankItemSchema),
  usage: Schema.Struct({
    total_tokens: Schema.Number,
    prompt_tokens: Schema.Number,
  }),
});

export type JinaInput =
  | string
  | Uint8Array
  | Blob
  | { text?: string; image?: string | Uint8Array | Blob; url?: string };

export const normalizeInput = Effect.fn("normalizeInput")(function* (input: JinaInput) {
  if (typeof input === "string") {
    const isUrl = /^(http|https):\/\/[^ "]+$/.test(input);
    return isUrl ? { url: input } : { text: input };
  }

  if (input instanceof Uint8Array) {
    const base64 = Buffer.from(input).toString("base64");
    return { image: base64 };
  }

  if (input instanceof Blob) {
    const arrayBuffer = yield* Effect.tryPromise({
      try: () => input.arrayBuffer(),
      catch: (e) => new JinaError({ message: "Failed to read blob", cause: e }),
    });
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { image: base64 };
  }

  if (typeof input === "object" && input !== null) {
    if ("image" in input && input.image) {
      const image = input.image;
      if (image instanceof Uint8Array) {
        const base64 = Buffer.from(image).toString("base64");
        return { ...input, image: base64 };
      }
      if (image instanceof Blob) {
        const arrayBuffer = yield* Effect.tryPromise({
          try: () => image.arrayBuffer(),
          catch: (e) => new JinaError({ message: "Failed to read blob", cause: e }),
        });
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return { ...input, image: base64 };
      }
    }
    return input;
  }

  return yield* new JinaError({ message: "Invalid input format" });
});

interface JinaServiceShape {
  readonly embed: {
    (input: JinaInput): Effect.Effect<EmbeddedResult, JinaError>;
    (input: JinaInput[]): Effect.Effect<EmbeddedResult[], JinaError>;
  };
  readonly rerank: (query: string, docs: string[]) => Effect.Effect<RerankResult[], JinaError>;
}

export class JinaService extends Context.Tag("JinaService")<JinaService, JinaServiceShape>() {}

export const JinaServiceLive = Layer.effect(
  JinaService,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("JINA_API_KEY");
    const client = yield* HttpClient.HttpClient;

    const embedOne = (input: JinaInput): Effect.Effect<EmbeddedResult, JinaError, never> =>
      Effect.gen(function* () {
        const normalizedInput = yield* normalizeInput(input);

        const request = yield* HttpClientRequest.post("https://api.jina.ai/v1/embeddings").pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
          HttpClientRequest.setHeader("Content-Type", "application/json"),
          HttpClientRequest.bodyJson({
            model: "jina-embeddings-v4",
            input: [normalizedInput],
            late_chunking: true,
            return_multivector: true,
          }),
          Effect.mapError(
            (error) => new JinaError({ message: "Failed to serialize request body", cause: error }),
          ),
        );

        const response = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JinaEmbeddingResponseSchema)),
          Effect.mapError((error) => new JinaError({ message: "Embed Error", cause: error })),
        );

        const item = response.data[0];
        if (!item) {
          return yield* new JinaError({ message: "No embedding returned" });
        }
        return {
          full: [...item.embedding],
          multi: item.multi_vector ? item.multi_vector.map((m) => [...m]) : undefined,
          scout: item.embedding.slice(0, 256),
        };
      }).pipe(Effect.withSpan("JinaService.embedOne"));

    const embedMany = (inputs: JinaInput[]): Effect.Effect<EmbeddedResult[], JinaError, never> =>
      Effect.gen(function* () {
        const normalizedInputs = yield* Effect.all(inputs.map(normalizeInput));

        const request = yield* HttpClientRequest.post("https://api.jina.ai/v1/embeddings").pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
          HttpClientRequest.setHeader("Content-Type", "application/json"),
          HttpClientRequest.bodyJson({
            model: "jina-embeddings-v4",
            input: normalizedInputs,
            late_chunking: true,
            return_multivector: true,
          }),
          Effect.mapError(
            (error) => new JinaError({ message: "Failed to serialize request body", cause: error }),
          ),
        );

        const response = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JinaEmbeddingResponseSchema)),
          Effect.mapError((error) => new JinaError({ message: "Embed Error", cause: error })),
        );

        if (!response.data || response.data.length === 0) {
          return yield* new JinaError({ message: "No embedding returned" });
        }

        return response.data.map((item) => ({
          full: [...item.embedding],
          multi: item.multi_vector ? item.multi_vector.map((m) => [...m]) : undefined,
          scout: item.embedding.slice(0, 256),
        }));
      }).pipe(Effect.withSpan("JinaService.embedMany"));

    const embed = ((input: JinaInput | JinaInput[]) =>
      Array.isArray(input) ? embedMany(input) : embedOne(input)) as JinaServiceShape["embed"];

    const rerank = Effect.fn("JinaService.rerank")(function* (query: string, docs: string[]) {
      const request = yield* HttpClientRequest.post("https://api.jina.ai/v1/rerank").pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
        HttpClientRequest.setHeader("Content-Type", "application/json"),
        HttpClientRequest.bodyJson({
          model: "jina-reranker-v2-base-multilingual",
          query,
          documents: docs,
        }),
        Effect.mapError(
          (error) => new JinaError({ message: "Failed to serialize request body", cause: error }),
        ),
      );

      const response = yield* client.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(JinaRerankResponseSchema)),
        Effect.mapError((error) => new JinaError({ message: "Rerank Error", cause: error })),
      );

      return response.results.map((r) => ({
        index: r.index,
        relevance_score: r.relevance_score,
        document: { text: r.document.text },
      }));
    });

    return { embed, rerank };
  }),
);
export const JinaServiceTest = Layer.succeed(
  JinaService,
  JinaService.of({
    embed: ((input: JinaInput | JinaInput[]) => {
      const isArray = Array.isArray(input);
      const mockResult: EmbeddedResult = {
        scout: [0.1, 0.2, 0.3],
        full: [0.1, 0.2, 0.3],
        multi: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      };
      return Effect.succeed(isArray ? [mockResult] : mockResult);
    }) as JinaServiceShape["embed"],
    rerank: (_query, docs) =>
      Effect.succeed(
        docs.map((doc, index) => ({
          index,
          relevance_score: 0.9 - index * 0.1,
          document: { text: doc },
        })),
      ),
  }),
);
