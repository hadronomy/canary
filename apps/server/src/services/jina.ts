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

export class JinaService extends Context.Tag("JinaService")<
  JinaService,
  {
    readonly embed: (text: string) => Effect.Effect<EmbeddedResult, JinaError>;
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

    const embed = (text: string) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch("https://api.jina.ai/v1/embeddings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "jina-embeddings-v3",
              input: [text],
              late_chunking: true,
              return_multivector: true,
            }),
          });

          if (!response.ok) {
            throw new JinaError({
              message: `Jina API Error: ${response.status} ${await response.text()}`,
            });
          }

          const data = (await response.json()) as JinaEmbeddingResponse;
          const item = data.data[0];

          if (!item) {
            throw new JinaError({ message: "No embedding returned" });
          }

          return {
            full: item.embedding,
            multi: item.multi_vector,
            scout: item.embedding?.slice(0, 256),
          } as EmbeddedResult;
        },
        catch: (error) =>
          error instanceof JinaError
            ? error
            : new JinaError({ message: "Embed Error", cause: error }),
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
    embed: (_text) =>
      Effect.succeed({
        scout: [0.1, 0.2, 0.3],
        full: [0.1, 0.2, 0.3],
        multi: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      }),
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
