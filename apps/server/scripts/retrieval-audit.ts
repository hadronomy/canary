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

type RetrievalStrategy = {
  allowExpansion: boolean;
  articleNumberDigits: string | null;
  authorityHintNormalized: string | null;
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
  "artículo 14 constitución",
  "artículo 12 de la constitución española",
];

const benchmarkRuns = Number.parseInt(Bun.env.RETRIEVAL_BENCH_RUNS ?? "6", 10);
const annCandidates = Number.parseInt(Bun.env.RETRIEVAL_ANN_CANDIDATES ?? "64", 10);
const rerankCandidates = Number.parseInt(Bun.env.RETRIEVAL_RERANK_CANDIDATES ?? "16", 10);
const seedCount = Number.parseInt(Bun.env.RETRIEVAL_LTREE_SEEDS ?? "4", 10);
const neighborsPerSeed = Number.parseInt(Bun.env.RETRIEVAL_LTREE_NEIGHBORS ?? "6", 10);
const hnswEfSearch = Number.parseInt(Bun.env.RETRIEVAL_HNSW_EF_SEARCH ?? "48", 10);
const expansionMinRerank = Number.parseFloat(Bun.env.RETRIEVAL_EXPANSION_MIN_RERANK ?? "0.45");
const maxPerNode = Number.parseInt(Bun.env.RETRIEVAL_MAX_PER_NODE ?? "2", 10);
const finalLimit = Number.parseInt(Bun.env.RETRIEVAL_FINAL_LIMIT ?? "12", 10);
const citationExactBoost = Number.parseFloat(Bun.env.RETRIEVAL_CITATION_EXACT_BOOST ?? "0.14");
const citationMismatchPenalty = Number.parseFloat(
  Bun.env.RETRIEVAL_CITATION_MISMATCH_PENALTY ?? "0.1",
);
const authorityHintBoost = Number.parseFloat(
  Bun.env.RETRIEVAL_AUTHORITY_HINT_BOOST ?? Bun.env.RETRIEVAL_CONSTITUTION_HINT_BOOST ?? "0.12",
);
const authorityMismatchPenalty = Number.parseFloat(
  Bun.env.RETRIEVAL_AUTHORITY_MISMATCH_PENALTY ??
    Bun.env.RETRIEVAL_CONSTITUTION_MISMATCH_PENALTY ??
    "0.08",
);
const citationCandidates = Number.parseInt(Bun.env.RETRIEVAL_CITATION_CANDIDATES ?? "8", 10);

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

function normalizeQueryText(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/\bart\.?\s*(\d+)/giu, "artículo $1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractArticleNumberDigits(query: string): string | null {
  const match = query.match(/\bart[ií]culo\s+(\d+)\b/iu);
  return match?.[1] ?? null;
}

function normalizeHintText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAuthorityHint(query: string): string | null {
  const citationTail = query.match(/\bart[ií]culo\s+\d+\s+(.+)$/iu)?.[1];
  if (!citationTail) {
    return null;
  }

  const stopwords = new Set(["de", "del", "la", "el", "las", "los", "y", "en", "para"]);
  const tokens = normalizeHintText(citationTail)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopwords.has(token));
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, 3).join(" ");
}

function buildRetrievalStrategy(query: string): RetrievalStrategy {
  const structuralPattern =
    /\b(art[ií]culo|disposici[oó]n|deroga|cap[ií]tulo|secci[oó]n|apartado|anexo|t[ií]tulo)\b/iu;
  return {
    allowExpansion: structuralPattern.test(query),
    articleNumberDigits: extractArticleNumberDigits(query),
    authorityHintNormalized: extractAuthorityHint(query),
  };
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
    sf.sequence_index,
    sf.node_path_ltree,
    sf.legal_node_path_ltree,
    0::int AS source_priority,
    (1 - (sf.embedding_256 <=> $1::vector(256)))::float8 AS semantic_256
  FROM sense_fragments sf
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  WHERE sf.embedding_256 IS NOT NULL
    AND sf.embedding_1024 IS NOT NULL
    AND ld.legislative_stage = 'enacted'
    AND (
      NOT $13::boolean
      OR (
        $19::text <> ''
        AND translate(lower(ld.official_title), 'áéíóúüñ', 'aeiouun') LIKE ('%' || $19::text || '%')
      )
    )
    AND sf.node_type IN ('article', 'paragraph', 'section', 'chapter', 'subsection')
  ORDER BY sf.embedding_256 <=> $1::vector(256)
  LIMIT $3
),
citation_direct AS (
  SELECT
    sf.fragment_id,
    sf.doc_id,
    sf.version_id,
    sf.sequence_index,
    sf.node_path_ltree,
    sf.legal_node_path_ltree,
    1::int AS source_priority,
    (1 - (sf.embedding_256 <=> $1::vector(256)))::float8 AS semantic_256
  FROM sense_fragments sf
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  WHERE $11::boolean
    AND $12::text <> ''
    AND sf.embedding_256 IS NOT NULL
    AND sf.embedding_1024 IS NOT NULL
    AND ld.legislative_stage = 'enacted'
    AND (
      NOT $13::boolean
      OR (
        $19::text <> ''
        AND translate(lower(ld.official_title), 'áéíóúüñ', 'aeiouun') LIKE ('%' || $19::text || '%')
      )
    )
    AND sf.node_type IN ('article', 'paragraph')
    AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = $12::text
  ORDER BY
    CASE WHEN sf.node_type = 'article' THEN 0 ELSE 1 END,
    sf.sequence_index ASC
  LIMIT $18
),
base_candidates AS (
  SELECT DISTINCT ON (c.fragment_id)
    c.fragment_id,
    c.doc_id,
    c.version_id,
    c.sequence_index,
    c.node_path_ltree,
    c.legal_node_path_ltree,
    c.semantic_256
  FROM (
    SELECT * FROM ann
    UNION ALL
    SELECT * FROM citation_direct
  ) c
  ORDER BY c.fragment_id, c.source_priority DESC
),
rerank_seed AS (
  SELECT
    bc.fragment_id,
    bc.doc_id,
    bc.version_id,
    bc.sequence_index,
    bc.node_path_ltree,
    bc.legal_node_path_ltree,
    bc.semantic_256,
    (1 - (sf.embedding_1024 <=> $2::vector(1024)))::float8 AS rerank_1024,
    ROW_NUMBER() OVER (ORDER BY sf.embedding_1024 <=> $2::vector(1024))::int AS rerank_rank
  FROM base_candidates bc
  JOIN sense_fragments sf ON sf.fragment_id = bc.fragment_id
  ORDER BY sf.embedding_1024 <=> $2::vector(1024)
  LIMIT $4
),
seed_top AS (
  SELECT *
  FROM rerank_seed
  WHERE rerank_rank <= $5
    AND (rerank_1024 >= $8 OR rerank_rank = 1)
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
    ORDER BY
      (x.embedding_1024 <=> $2::vector(1024)) ASC,
      ABS(x.sequence_index - st.sequence_index) ASC
    LIMIT $6
  ) sf2 ON $7::boolean
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
  SELECT fragment_id, 0::int AS hop_distance FROM citation_direct
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
    ld.canonical_id,
    ld.official_title,
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
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  WHERE sf.embedding_1024 IS NOT NULL
),
scored AS (
  SELECT
    fr.fragment_id,
    fr.doc_id,
    fr.version_id,
    fr.canonical_id,
    fr.official_title,
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
      + (CASE
        WHEN $11::boolean AND $12::text <> '' THEN
          CASE
            WHEN regexp_replace(COALESCE(fr.node_number, ''), '[^0-9]', '', 'g') = $12::text THEN $14::float8
            WHEN fr.node_type = 'article' THEN -$15::float8
            ELSE -($15::float8 * 0.35)
          END
        ELSE 0
      END)
      + (CASE
        WHEN $13::boolean THEN
          CASE
            WHEN $19::text <> ''
              AND translate(lower(fr.official_title), 'áéíóúüñ', 'aeiouun') LIKE ('%' || $19::text || '%')
            THEN $16::float8
            ELSE -$17::float8
          END
        ELSE 0
      END)
    )::float8 AS base_score
  FROM final_rank fr
),
diversified AS (
  SELECT
    s.fragment_id,
    s.doc_id,
    s.version_id,
    s.canonical_id,
    s.official_title,
    s.node_type,
    s.node_number,
    s.node_title,
    s.node_path,
    s.snippet,
    s.rerank_1024,
    s.semantic_256,
    s.hop_distance,
    s.base_score,
    ROW_NUMBER() OVER (
      PARTITION BY s.doc_id, COALESCE(NULLIF(s.node_number, ''), s.node_path)
      ORDER BY s.base_score DESC, s.rerank_1024 DESC
    )::int AS node_dup_rank
  FROM scored s
)
SELECT
  d.fragment_id,
  d.doc_id,
  d.version_id,
  d.canonical_id,
  d.official_title,
  d.node_type,
  d.node_number,
  d.node_title,
  d.node_path,
  d.snippet,
  d.rerank_1024,
  d.semantic_256,
  d.hop_distance,
  (
    d.base_score * (CASE
      WHEN d.node_dup_rank = 1 THEN 1
      WHEN d.node_dup_rank = 2 THEN 0.92
      ELSE 0.85
    END)
  )::float8 AS score
FROM diversified d
WHERE d.node_dup_rank <= $9
ORDER BY score DESC, d.rerank_1024 DESC
LIMIT $10
`;

async function runFastQuery(
  client: Client,
  vector256Literal: string,
  vector1024Literal: string,
  strategy: RetrievalStrategy,
): Promise<SearchHit[]> {
  const result = await client.query<SearchHit>(fastSql, [
    vector256Literal,
    vector1024Literal,
    annCandidates,
    rerankCandidates,
    seedCount,
    neighborsPerSeed,
    strategy.allowExpansion,
    expansionMinRerank,
    maxPerNode,
    finalLimit,
    strategy.articleNumberDigits !== null,
    strategy.articleNumberDigits ?? "",
    strategy.authorityHintNormalized !== null,
    citationExactBoost,
    citationMismatchPenalty,
    authorityHintBoost,
    authorityMismatchPenalty,
    citationCandidates,
    strategy.authorityHintNormalized ?? "",
  ]);
  return result.rows;
}

async function benchmarkQuery(
  client: Client,
  vector256Literal: string,
  vector1024Literal: string,
  strategy: RetrievalStrategy,
): Promise<{ stats: LatencyStats; hits: SearchHit[] }> {
  // await runFastQuery(client, vector256Literal, vector1024Literal);

  const samples: number[] = [];
  let finalHits: SearchHit[] = [];
  for (let index = 0; index < benchmarkRuns; index += 1) {
    const startedAt = performance.now();
    finalHits = await runFastQuery(client, vector256Literal, vector1024Literal, strategy);
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
      const normalizedQuery = normalizeQueryText(query);
      const strategy = buildRetrievalStrategy(normalizedQuery);
      const embedding = await embedQuery(normalizedQuery);
      const vector256Literal = toVectorLiteral(embedding.scout);
      const vector1024Literal = toVectorLiteral(embedding.full);

      const benchmark = await benchmarkQuery(client, vector256Literal, vector1024Literal, strategy);
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
            expansionMinRerank,
            maxPerNode,
            finalLimit,
            citationExactBoost,
            citationMismatchPenalty,
            authorityHintBoost,
            authorityMismatchPenalty,
            citationCandidates,
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
