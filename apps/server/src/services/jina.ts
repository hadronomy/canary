import { Context, Data, Effect, Layer, Config } from "effect";

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

export interface JinaEmbeddingItem {
  readonly embedding: number[];
  readonly multi_vector?: number[][];
  readonly index: number;
}

export interface JinaEmbeddingResponse {
  readonly model: string;
  readonly data: JinaEmbeddingItem[];
  readonly usage: {
    readonly total_tokens: number;
    readonly prompt_tokens: number;
  };
}

export interface JinaRerankItem {
  readonly index: number;
  readonly relevance_score: number;
  readonly document: {
    readonly text: string;
  };
}

export interface JinaRerankResponse {
  readonly model: string;
  readonly results: JinaRerankItem[];
  readonly usage: {
    readonly total_tokens: number;
    readonly prompt_tokens: number;
  };
}

export type JinaInput =
  | string
  | Uint8Array
  | Blob
  | { text?: string; image?: string | Uint8Array | Blob; url?: string };

export const normalizeInput = (input: JinaInput): Effect.Effect<object, JinaError> =>
  Effect.gen(function* () {
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

    return yield* Effect.fail(new JinaError({ message: "Invalid input format" }));
  });

export class JinaService extends Context.Tag("JinaService")<
  JinaService,
  {
    readonly embed: (
      input: JinaInput | JinaInput[],
    ) => Effect.Effect<EmbeddedResult | EmbeddedResult[], JinaError>;
    readonly rerank: (
      query: string,
      docs: string[],
    ) => Effect.Effect<Array<RerankResult>, JinaError>;
  }
>() {}

export const JinaServiceLive = Layer.effect(
  JinaService,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("JINA_API_KEY");

    const embed = (input: JinaInput | JinaInput[]) =>
      Effect.gen(function* () {
        const inputs = Array.isArray(input) ? input : [input];
        const normalizedInputs = yield* Effect.all(inputs.map(normalizeInput));

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch("https://api.jina.ai/v1/embeddings", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "jina-embeddings-v3",
                input: normalizedInputs,
                late_chunking: true,
                return_multivector: true,
              }),
            }),
          catch: (error) => new JinaError({ message: "Embed Error", cause: error }),
        });

        if (!response.ok) {
          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (e) => new JinaError({ message: "Failed to read response", cause: e }),
          });
          return yield* Effect.fail(
            new JinaError({
              message: `Jina API Error: ${response.status} ${text}`,
            }),
          );
        }

        const data = yield* Effect.tryPromise({
          try: () => response.json() as Promise<JinaEmbeddingResponse>,
          catch: (e) => new JinaError({ message: "Failed to parse JSON", cause: e }),
        });
        const item = data.data[0];

        if (!item) {
          return yield* Effect.fail(new JinaError({ message: "No embedding returned" }));
        }

        return {
          full: item.embedding,
          multi: item.multi_vector,
          scout: item.embedding?.slice(0, 256),
        } as EmbeddedResult;
      });

    const rerank = (query: string, docs: string[]) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch("https://api.jina.ai/v1/rerank", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "jina-reranker-v2-base-multilingual",
              query,
              documents: docs,
            }),
          });

          if (!response.ok) {
            throw new JinaError({
              message: `Jina API Error: ${response.status} ${await response.text()}`,
            });
          }

          const data = (await response.json()) as JinaRerankResponse;
          return data.results.map((r) => ({
            index: r.index,
            relevance_score: r.relevance_score,
            document: r.document,
          })) as Array<RerankResult>;
        },
        catch: (error) =>
          error instanceof JinaError
            ? error
            : new JinaError({ message: "Rerank Error", cause: error }),
      });

    return { embed, rerank };
  }),
);
export const JinaServiceTest = Layer.succeed(
  JinaService,
  JinaService.of({
    embed: (input) => {
      const isArray = Array.isArray(input);
      const mockResult = {
        scout: [0.1, 0.2, 0.3],
        full: [0.1, 0.2, 0.3],
        multi: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      };
      return Effect.succeed(isArray ? [mockResult] : mockResult);
    },
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
