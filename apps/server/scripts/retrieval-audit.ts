import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import { ConfigProvider, Effect, Layer } from "effect";
import { Client } from "pg";

import { EmbeddingService, EmbeddingServiceLive } from "~/services/embedding";

type SearchHit = {
  fragment_id: string;
  doc_id: string;
  version_id: string | null;
  canonical_id: string;
  official_title: string;
  node_type: string;
  node_number: string | null;
  node_title: string | null;
  node_path: string;
  snippet: string;
  rerank_1024: number;
  semantic_256: number;
  hop_distance: number;
  score: number;
};

type QueryEmbedding = {
  scout: number[];
  full: number[];
};

type LatencyStats = {
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
  avgMs: number;
};

const queries = [
  "derechos fundamentales libertad expresion limite",
  "competencias del gobierno y potestad reglamentaria",
  "disposicion final deroga leyes anteriores",
  "canarias derechos autonomicos competencias exclusivas",
];

const benchmarkRuns = Number.parseInt(Bun.env.RETRIEVAL_BENCH_RUNS ?? "6", 10);
const annCandidates = Number.parseInt(Bun.env.RETRIEVAL_ANN_CANDIDATES ?? "64", 10);
const rerankCandidates = Number.parseInt(Bun.env.RETRIEVAL_RERANK_CANDIDATES ?? "16", 10);
const seedCount = Number.parseInt(Bun.env.RETRIEVAL_LTREE_SEEDS ?? "4", 10);
const neighborsPerSeed = Number.parseInt(Bun.env.RETRIEVAL_LTREE_NEIGHBORS ?? "6", 10);
const hnswEfSearch = Number.parseInt(Bun.env.RETRIEVAL_HNSW_EF_SEARCH ?? "48", 10);

const embeddingLayer = EmbeddingServiceLive.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(Layer.setConfigProvider(ConfigProvider.fromEnv())),
);

const tokenLimitPauseMs = Number.parseInt(Bun.env.RETRIEVAL_TOKEN_LIMIT_PAUSE_MS ?? "65000", 10);
const concurrencyBaseBackoffMs = Number.parseInt(
  Bun.env.RETRIEVAL_CONCURRENCY_BACKOFF_MS ?? "1200",
  10,
);

function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function computeStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const p50Ms = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
  const p90Ms = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
  const avgMs =
    sorted.length === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    minMs: Math.round(minMs * 100) / 100,
    p50Ms: Math.round(p50Ms * 100) / 100,
    p90Ms: Math.round(p90Ms * 100) / 100,
    maxMs: Math.round(maxMs * 100) / 100,
    avgMs: Math.round(avgMs * 100) / 100,
  };
}

async function embedQuery(query: string): Promise<QueryEmbedding> {
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const program = Effect.flatMap(EmbeddingService, (service) => service.embed(query)).pipe(
        Effect.provide(embeddingLayer),
      );

      const result = await Effect.runPromise(program);
      if (Array.isArray(result)) {
        throw new Error("Expected single embedding result");
      }

      return {
        scout: result.scout,
        full: result.full,
      };
    } catch (error) {
      const message = String(error);
      const isConcurrencyLimited =
        message.includes("RATE_CONCURRENCY_LIMIT_EXCEEDED") ||
        message.includes("Concurrency limit exceeded");
      const isTokenLimited =
        message.includes("RATE_TOKEN_LIMIT_EXCEEDED") ||
        message.includes("Token rate limit exceeded");
      const retryable = message.includes("429") || isConcurrencyLimited || isTokenLimited;
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 250);
      if (isTokenLimited) {
        await Bun.sleep(tokenLimitPauseMs + jitter);
      } else {
        const waitMs = Math.min(10_000, concurrencyBaseBackoffMs * 2 ** (attempt - 1));
        await Bun.sleep(waitMs + jitter);
      }
    }
  }

  throw new Error("Unable to generate query embedding after retries");
}

const fastSql = `
WITH ann AS (
  SELECT
    sf.fragment_id,
    sf.doc_id,
    sf.version_id,
    sf.node_path_ltree,
    sf.legal_node_path_ltree,
    (1 - (sf.embedding_256 <=> $1::vector(256)))::float8 AS semantic_256
  FROM sense_fragments sf
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  WHERE sf.embedding_256 IS NOT NULL
    AND sf.embedding_1024 IS NOT NULL
    AND ld.legislative_stage = 'enacted'
    AND sf.node_type IN ('article', 'paragraph', 'section', 'chapter', 'subsection')
  ORDER BY sf.embedding_256 <=> $1::vector(256)
  LIMIT $3
),
rerank_seed AS (
  SELECT
    ann.fragment_id,
    ann.doc_id,
    ann.version_id,
    ann.node_path_ltree,
    ann.legal_node_path_ltree,
    ann.semantic_256,
    (1 - (sf.embedding_1024 <=> $2::vector(1024)))::float8 AS rerank_1024,
    ROW_NUMBER() OVER (ORDER BY sf.embedding_1024 <=> $2::vector(1024))::int AS rerank_rank
  FROM ann
  JOIN sense_fragments sf ON sf.fragment_id = ann.fragment_id
  ORDER BY sf.embedding_1024 <=> $2::vector(1024)
  LIMIT $4
),
seed_top AS (
  SELECT *
  FROM rerank_seed
  WHERE rerank_rank <= $5
),
expanded AS (
  SELECT
    st.fragment_id AS seed_fragment_id,
    sf2.fragment_id,
    CASE
      WHEN sf2.node_path_ltree @> st.node_path_ltree THEN 1
      WHEN sf2.node_path_ltree <@ st.node_path_ltree THEN 1
      WHEN sf2.legal_node_path_ltree IS NOT NULL
        AND st.legal_node_path_ltree IS NOT NULL
        AND (sf2.legal_node_path_ltree @> st.legal_node_path_ltree OR sf2.legal_node_path_ltree <@ st.legal_node_path_ltree)
      THEN 2
      ELSE 3
    END::int AS hop_distance
  FROM seed_top st
  JOIN LATERAL (
    SELECT
      x.fragment_id,
      x.node_path_ltree,
      x.legal_node_path_ltree,
      x.sequence_index
    FROM sense_fragments x
    WHERE x.doc_id = st.doc_id
      AND x.version_id = st.version_id
      AND x.embedding_1024 IS NOT NULL
      AND x.fragment_id <> st.fragment_id
      AND (
        (
          x.node_path_ltree @> st.node_path_ltree
          AND nlevel(st.node_path_ltree) - nlevel(x.node_path_ltree) = 1
        )
        OR (
          x.node_path_ltree <@ st.node_path_ltree
          AND nlevel(x.node_path_ltree) - nlevel(st.node_path_ltree) = 1
        )
        OR (
          nlevel(x.node_path_ltree) = nlevel(st.node_path_ltree)
          AND subpath(x.node_path_ltree, 0, nlevel(x.node_path_ltree) - 1)
              = subpath(st.node_path_ltree, 0, nlevel(st.node_path_ltree) - 1)
        )
        OR (
          x.legal_node_path_ltree IS NOT NULL
          AND st.legal_node_path_ltree IS NOT NULL
          AND (
            x.legal_node_path_ltree @> st.legal_node_path_ltree
            OR x.legal_node_path_ltree <@ st.legal_node_path_ltree
          )
        )
      )
    ORDER BY x.sequence_index ASC
    LIMIT $6
  ) sf2 ON true
),
expanded_best AS (
  SELECT
    e.fragment_id,
    MIN(e.hop_distance)::int AS hop_distance
  FROM expanded e
  GROUP BY e.fragment_id
),
candidate_ids AS (
  SELECT fragment_id, 0::int AS hop_distance FROM rerank_seed
  UNION
  SELECT fragment_id, hop_distance FROM expanded_best
),
dedup AS (
  SELECT DISTINCT ON (fragment_id)
    fragment_id,
    hop_distance
  FROM candidate_ids
  ORDER BY fragment_id, hop_distance ASC
),
final_rank AS (
  SELECT
    sf.fragment_id,
    sf.doc_id,
    sf.version_id,
    sf.node_type,
    sf.node_number,
    sf.node_title,
    sf.node_path,
    LEFT(COALESCE(sf.content_normalized, sf.content), 240) AS snippet,
    (1 - (sf.embedding_1024 <=> $2::vector(1024)))::float8 AS rerank_1024,
    (1 - (sf.embedding_256 <=> $1::vector(256)))::float8 AS semantic_256,
    d.hop_distance
  FROM dedup d
  JOIN sense_fragments sf ON sf.fragment_id = d.fragment_id
  WHERE sf.embedding_1024 IS NOT NULL
)
SELECT
  fr.fragment_id,
  fr.doc_id,
  fr.version_id,
  ld.canonical_id,
  ld.official_title,
  fr.node_type,
  fr.node_number,
  fr.node_title,
  fr.node_path,
  fr.snippet,
  fr.rerank_1024,
  fr.semantic_256,
  fr.hop_distance,
  (
    0.74 * fr.rerank_1024
    + 0.21 * fr.semantic_256
    + 0.05 * (CASE
      WHEN fr.hop_distance = 0 THEN 1
      WHEN fr.hop_distance = 1 THEN 0.7
      WHEN fr.hop_distance = 2 THEN 0.5
      ELSE 0.3
    END)
  )::float8 AS score
FROM final_rank fr
JOIN legal_documents ld ON ld.doc_id = fr.doc_id
ORDER BY score DESC, fr.rerank_1024 DESC
LIMIT 12
`;

async function runFastQuery(
  client: Client,
  vector256Literal: string,
  vector1024Literal: string,
): Promise<SearchHit[]> {
  const result = await client.query<SearchHit>(fastSql, [
    vector256Literal,
    vector1024Literal,
    annCandidates,
    rerankCandidates,
    seedCount,
    neighborsPerSeed,
  ]);
  return result.rows;
}

async function benchmarkQuery(
  client: Client,
  vector256Literal: string,
  vector1024Literal: string,
): Promise<{ stats: LatencyStats; hits: SearchHit[] }> {
  // await runFastQuery(client, vector256Literal, vector1024Literal);

  const samples: number[] = [];
  let finalHits: SearchHit[] = [];
  for (let index = 0; index < benchmarkRuns; index += 1) {
    const startedAt = performance.now();
    finalHits = await runFastQuery(client, vector256Literal, vector1024Literal);
    const latencyMs = performance.now() - startedAt;
    samples.push(latencyMs);
  }

  return {
    stats: computeStats(samples),
    hits: finalHits,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`SET hnsw.ef_search = ${hnswEfSearch}`);

    const output: Record<string, { dbLatency: LatencyStats; hits: SearchHit[] }> = {};
    for (const query of queries) {
      const embedding = await embedQuery(query);
      const vector256Literal = toVectorLiteral(embedding.scout);
      const vector1024Literal = toVectorLiteral(embedding.full);

      const benchmark = await benchmarkQuery(client, vector256Literal, vector1024Literal);
      output[query] = {
        dbLatency: benchmark.stats,
        hits: benchmark.hits,
      };
    }

    console.log(
      JSON.stringify(
        {
          config: {
            benchmarkRuns,
            annCandidates,
            rerankCandidates,
            seedCount,
            neighborsPerSeed,
            hnswEfSearch,
            tokenLimitPauseMs,
            concurrencyBaseBackoffMs,
          },
          results: output,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

await main();
