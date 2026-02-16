import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { AutoTokenizer, type PreTrainedTokenizer } from "@huggingface/transformers";
import {
  Cache,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
} from "effect";

/**
 * Unified error type for embedding and reranking operations.
 *
 * @example
 * ```ts
 * const result = yield* service.embed("hello").pipe(
 *   Effect.catchTag("EmbeddingServiceError", (error) =>
 *     Effect.logWarning("Embedding failed", { message: error.message }),
 *   ),
 * );
 * ```
 */
export class EmbeddingServiceError extends Data.TaggedError("EmbeddingServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Result shape returned by the embedding endpoint.
 *
 * - `scout`: compact vector (first 256 dims) for lightweight retrieval stages.
 * - `full`: full embedding vector as returned by model.
 * - `multi`: optional multi-vector representation for late interaction setups.
 */
export interface EmbeddedResult {
  readonly scout?: number[];
  readonly full?: number[];
  readonly multi?: number[][];
}

export interface TokenCountResult {
  readonly model: string;
  readonly counts: ReadonlyArray<number>;
}

/**
 * Result shape returned by the reranking endpoint.
 */
export interface RerankResult {
  readonly index: number;
  readonly relevance_score: number;
  readonly document?: {
    readonly text: string;
  };
}

const EmbeddingItemSchema = Schema.Struct({
  embedding: Schema.Array(Schema.Number),
  multi_vector: Schema.optional(Schema.Array(Schema.Array(Schema.Number))),
  index: Schema.Number,
});

const EmbeddingResponseSchema = Schema.Struct({
  model: Schema.String,
  data: Schema.Array(EmbeddingItemSchema),
  usage: Schema.Struct({
    total_tokens: Schema.Number,
    prompt_tokens: Schema.Number,
  }),
});

const RerankItemSchema = Schema.Struct({
  index: Schema.Number,
  relevance_score: Schema.Number,
  document: Schema.Struct({
    text: Schema.String,
  }),
});

const RerankResponseSchema = Schema.Struct({
  model: Schema.String,
  results: Schema.Array(RerankItemSchema),
  usage: Schema.Struct({
    total_tokens: Schema.Number,
    prompt_tokens: Schema.Number,
  }),
});

/**
 * Accepted input payload for embedding generation.
 *
 * - `string`: auto-detected as URL or plain text.
 * - `Uint8Array` / `Blob`: converted to base64 image payload.
 * - object payload: pass `text`, `url`, and/or `image` explicitly.
 */
export type EmbeddingInput =
  | string
  | Uint8Array
  | Blob
  | { text?: string; image?: string | Uint8Array | Blob; url?: string };

/**
 * Normalizes supported embedding inputs into API-compatible JSON payloads.
 *
 * @param input Raw embedding input.
 * @returns Normalized input object accepted by the embedding API.
 */
export const normalizeInput = Effect.fn("EmbeddingService.normalizeInput")(function* (
  input: EmbeddingInput,
) {
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
      catch: (cause) => new EmbeddingServiceError({ message: "Failed to read blob", cause }),
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
          catch: (cause) => new EmbeddingServiceError({ message: "Failed to read blob", cause }),
        });
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return { ...input, image: base64 };
      }
    }
    return input;
  }

  return yield* new EmbeddingServiceError({ message: "Invalid input format" });
});

interface EmbeddingServiceShape {
  /**
   * Computes embeddings for one or many inputs.
   *
   * @param input A single input or a batch of inputs.
   * @returns One embedding result for single input; an array for batch input.
   */
  readonly embed: {
    (input: EmbeddingInput): Effect.Effect<EmbeddedResult, EmbeddingServiceError>;
    (input: EmbeddingInput[]): Effect.Effect<EmbeddedResult[], EmbeddingServiceError>;
  };

  /**
   * Reranks documents by semantic relevance to the query.
   *
   * @param query User query text.
   * @param docs Candidate documents to rerank.
   */
  readonly rerank: (
    query: string,
    docs: string[],
  ) => Effect.Effect<RerankResult[], EmbeddingServiceError>;

  readonly countTokens: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<TokenCountResult, EmbeddingServiceError>;
}

/**
 * Embedding and reranking API service.
 *
 * Configuration:
 * - Requires `JINA_API_KEY` in runtime config.
 *
 * Endpoints:
 * - `POST /v1/embeddings`
 * - `POST /v1/rerank`
 */
export class EmbeddingService extends Context.Tag("EmbeddingService")<
  EmbeddingService,
  EmbeddingServiceShape
>() {
  static readonly DefaultModelName = "jina-embeddings-v4" as const;
  static readonly DefaultTokenizerModelName = "jinaai/jina-embeddings-v4" as const;
}

/**
 * Live layer backed by the remote embedding/rerank API.
 */
export const EmbeddingServiceLive = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("JINA_API_KEY");
    const client = yield* HttpClient.HttpClient;
    const tokenizerCache = yield* Cache.make<string, PreTrainedTokenizer, EmbeddingServiceError>({
      capacity: 16,
      timeToLive: Duration.infinity,
      lookup: (tokenizerModelName) =>
        Effect.tryPromise({
          try: () => AutoTokenizer.from_pretrained(tokenizerModelName, { local_files_only: false }),
          catch: (cause) =>
            new EmbeddingServiceError({
              message: `Failed to load tokenizer for model ${tokenizerModelName}`,
              cause,
            }),
        }),
    });

    const embedOne = (
      input: EmbeddingInput,
    ): Effect.Effect<EmbeddedResult, EmbeddingServiceError, never> =>
      embedMany([input]).pipe(
        Effect.flatMap((results) =>
          results[0]
            ? Effect.succeed(results[0])
            : new EmbeddingServiceError({ message: "No embedding returned" }),
        ),
        Effect.withSpan("EmbeddingService.embedOne"),
      );

    const embedMany = (
      inputs: EmbeddingInput[],
    ): Effect.Effect<EmbeddedResult[], EmbeddingServiceError, never> =>
      Effect.gen(function* () {
        const normalizedInputs = yield* Effect.all(inputs.map(normalizeInput));

        const request = yield* HttpClientRequest.post("https://api.jina.ai/v1/embeddings").pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
          HttpClientRequest.setHeader("Content-Type", "application/json"),
          HttpClientRequest.bodyJson({
            model: EmbeddingService.DefaultModelName,
            input: normalizedInputs,
            late_chunking: true,
            return_multivector: true,
          }),
          Effect.retry({
            schedule: Schedule.intersect(
              Schedule.exponential(Duration.millis(100)),
              Schedule.recurs(3),
            ),
          }),
          Effect.mapError(
            (cause) =>
              new EmbeddingServiceError({ message: "Failed to serialize request body", cause }),
          ),
        );

        const response = yield* client.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(EmbeddingResponseSchema)),
          Effect.mapError((cause) => new EmbeddingServiceError({ message: "Embed Error", cause })),
        );

        if (!response.data || response.data.length === 0) {
          return yield* new EmbeddingServiceError({ message: "No embedding returned" });
        }

        return response.data.map((item) => ({
          full: [...item.embedding],
          multi: item.multi_vector ? item.multi_vector.map((vector) => [...vector]) : undefined,
          scout: item.embedding.slice(0, 256),
        }));
      }).pipe(Effect.withSpan("EmbeddingService.embedMany"));

    const embed = ((input: EmbeddingInput | EmbeddingInput[]) =>
      Array.isArray(input) ? embedMany(input) : embedOne(input)) as EmbeddingServiceShape["embed"];

    const rerank = Effect.fn("EmbeddingService.rerank")(function* (query: string, docs: string[]) {
      const request = yield* HttpClientRequest.post("https://api.jina.ai/v1/rerank").pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(apiKey)}`),
        HttpClientRequest.setHeader("Content-Type", "application/json"),
        HttpClientRequest.bodyJson({
          model: "jina-reranker-v2-base-multilingual",
          query,
          documents: docs,
        }),
        Effect.mapError(
          (cause) =>
            new EmbeddingServiceError({ message: "Failed to serialize request body", cause }),
        ),
      );

      const response = yield* client.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(RerankResponseSchema)),
        Effect.mapError((cause) => new EmbeddingServiceError({ message: "Rerank Error", cause })),
      );

      return response.results.map((result) => ({
        index: result.index,
        relevance_score: result.relevance_score,
        document: { text: result.document.text },
      }));
    });

    const countTokens = Effect.fn("EmbeddingService.countTokens")(function* (
      texts: ReadonlyArray<string>,
    ) {
      const tokenizer = yield* tokenizerCache.get(EmbeddingService.DefaultTokenizerModelName);

      const counts = texts.map((text) => tokenizer.encode(text).length);

      return {
        model: EmbeddingService.DefaultModelName,
        counts,
      } satisfies TokenCountResult;
    });

    return { embed, rerank, countTokens };
  }),
);

/**
 * Deterministic test layer for local and unit test scenarios.
 */
export const EmbeddingServiceTest = Layer.succeed(
  EmbeddingService,
  EmbeddingService.of({
    embed: ((input: EmbeddingInput | EmbeddingInput[]) => {
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
    }) as EmbeddingServiceShape["embed"],
    rerank: (_query, docs) =>
      Effect.succeed(
        docs.map((doc, index) => ({
          index,
          relevance_score: 0.9 - index * 0.1,
          document: { text: doc },
        })),
      ),
    countTokens: (texts) =>
      Effect.succeed({
        model: EmbeddingService.DefaultModelName,
        counts: texts.map((text) => {
          const words = text
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length;
          return words === 0 ? 0 : words;
        }),
      }),
  }),
);
