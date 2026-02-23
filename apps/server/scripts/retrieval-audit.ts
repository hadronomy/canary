import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import ansis from "ansis";
import { ConfigProvider, Effect, Layer } from "effect";
import { barplot, bench, boxplot, group, run, summary } from "mitata";
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

type SearchHitRow = Omit<SearchHit, "rerank_1024" | "semantic_256" | "hop_distance" | "score"> & {
  rerank_1024: number | string;
  semantic_256: number | string;
  hop_distance: number | string;
  score: number | string;
};

type QueryEmbedding = {
  scout: number[];
  full: number[];
};

type RetrievalStrategy = {
  allowExpansion: boolean;
  articleNumberDigits: string | null;
  authorityHintNormalized: string | null;
  queryNormalized: string;
  hierarchyLevelHint: string | null;
};

type BenchmarkStats = {
  minMs: number;
  p75Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  avgMs: number;
};

type QueryAuditResult = {
  benchmarkName: string;
  toolName: RetrievalToolName;
  scenarioLabel: string;
  stats: BenchmarkStats;
  hits: SearchHitWithRole[];
};

type RetrievalToolName =
  | "polyvector_scout"
  | "temporal_structural"
  | "context_expansion"
  | "legal_multisearch";

type StructuralHints = {
  articleNumbers: string[];
  hierarchyLevel: string | null;
};

type LegalMultiSearchInput = {
  intents: string[];
  temporalContext: Date;
  structuralHints: StructuralHints;
};

type PreparedLegalMultiSearchInput = LegalMultiSearchInput & {
  normalizedQuery: string;
  intentScoutVectorLiterals: string[];
  primaryRerankVectorLiteral: string;
  allowExpansion: boolean;
  authorityHintNormalized: string | null;
};

type SearchHitWithRole = SearchHit & {
  role: string;
  intent_index: number | null;
  relation_type: string | null;
};

type SearchHitWithRoleRow = Omit<
  SearchHitWithRole,
  "rerank_1024" | "semantic_256" | "hop_distance" | "score" | "intent_index"
> & {
  rerank_1024: number | string;
  semantic_256: number | string;
  hop_distance: number | string;
  score: number | string;
  intent_index: number | string | null;
};

type MitataRunStats = {
  avg: number;
  min: number;
  p75: number;
  p99: number;
  p999: number;
  max: number;
};

type MitataRunResult = {
  name: string;
  stats?: MitataRunStats;
  error?: unknown;
};

type MitataBenchmark = {
  runs: MitataRunResult[];
};

type MitataSummary = {
  benchmarks: MitataBenchmark[];
  context?: {
    runtime?: string;
    version?: string;
    arch?: string;
    cpu?: {
      name?: string;
      freq?: number;
    };
  };
};

const toolScenarios: Array<{
  label: string;
  input: LegalMultiSearchInput;
}> = [
  {
    label: "Constitucional limits after Penal Code reform (2015)",
    input: {
      intents: [
        "libertad de expresion limites constitucionales articulo 20",
        "reforma codigo penal 2015 delitos expresion",
      ],
      temporalContext: new Date("2016-01-01T00:00:00.000Z"),
      structuralHints: {
        articleNumbers: ["20"],
        hierarchyLevel: "constitucion",
      },
    },
  },
  {
    label: "Constitution article 14 equality principle",
    input: {
      intents: ["artículo 14 constitución igualdad ante la ley"],
      temporalContext: new Date(),
      structuralHints: {
        articleNumbers: ["14"],
        hierarchyLevel: "constitucion",
      },
    },
  },
  {
    label: "Derogation clauses and final provisions",
    input: {
      intents: [
        "disposicion derogatoria unica deroga normas anteriores",
        "disposicion final modificaciones normas vigentes",
      ],
      temporalContext: new Date(),
      structuralHints: {
        articleNumbers: [],
        hierarchyLevel: null,
      },
    },
  },
  {
    label: "Regional competencies and regulatory powers",
    input: {
      intents: [
        "competencias del gobierno y potestad reglamentaria",
        "competencias exclusivas autonomia canarias",
      ],
      temporalContext: new Date(),
      structuralHints: {
        articleNumbers: [],
        hierarchyLevel: null,
      },
    },
  },
];

function parseIntegerEnv(key: string, fallback: number): number {
  const raw = Bun.env[key];
  if (raw === undefined) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return fallback;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseIntegerEnvWithMin(key: string, fallback: number, min: number): number {
  const parsed = parseIntegerEnv(key, fallback);
  return Math.max(min, parsed);
}

function parseFloatEnv(key: string, fallback: number): number {
  const raw = Bun.env[key];
  if (raw === undefined) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return fallback;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const annCandidates = parseIntegerEnvWithMin("RETRIEVAL_ANN_CANDIDATES", 64, 1);
const rerankCandidates = parseIntegerEnvWithMin("RETRIEVAL_RERANK_CANDIDATES", 16, 1);
const seedCount = parseIntegerEnvWithMin("RETRIEVAL_LTREE_SEEDS", 4, 1);
const neighborsPerSeed = parseIntegerEnvWithMin("RETRIEVAL_LTREE_NEIGHBORS", 6, 1);
const hnswEfSearch = parseIntegerEnvWithMin("RETRIEVAL_HNSW_EF_SEARCH", 48, 1);
const expansionMinRerank = parseFloatEnv("RETRIEVAL_EXPANSION_MIN_RERANK", 0.45);
const maxPerNode = parseIntegerEnvWithMin("RETRIEVAL_MAX_PER_NODE", 2, 1);
const finalLimit = parseIntegerEnvWithMin("RETRIEVAL_FINAL_LIMIT", 12, 1);
const citationExactBoost = parseFloatEnv("RETRIEVAL_CITATION_EXACT_BOOST", 0.14);
const citationMismatchPenalty = parseFloatEnv("RETRIEVAL_CITATION_MISMATCH_PENALTY", 0.1);
const authorityHintBoost = parseFloatEnv(
  "RETRIEVAL_AUTHORITY_HINT_BOOST",
  parseFloatEnv("RETRIEVAL_CONSTITUTION_HINT_BOOST", 0.12),
);
const authorityMismatchPenalty = parseFloatEnv(
  "RETRIEVAL_AUTHORITY_MISMATCH_PENALTY",
  parseFloatEnv("RETRIEVAL_CONSTITUTION_MISMATCH_PENALTY", 0.08),
);
const strictArticleExactBoost = parseFloatEnv("RETRIEVAL_STRICT_ARTICLE_EXACT_BOOST", 0.24);
const strictArticleMismatchPenalty = parseFloatEnv(
  "RETRIEVAL_STRICT_ARTICLE_MISMATCH_PENALTY",
  0.1,
);
const titleExactBoost = parseFloatEnv("RETRIEVAL_TITLE_EXACT_BOOST", 0.06);
const nodeTitleExactBoost = parseFloatEnv("RETRIEVAL_NODE_TITLE_EXACT_BOOST", 0.035);
const lexicalBoostRerankFloor = parseFloatEnv("RETRIEVAL_LEXICAL_BOOST_RERANK_FLOOR", 0.58);
const citationCandidates = parseIntegerEnvWithMin("RETRIEVAL_CITATION_CANDIDATES", 8, 1);

const embeddingLayer = EmbeddingServiceLive.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(Layer.setConfigProvider(ConfigProvider.fromEnv())),
);

const tokenLimitPauseMs = parseIntegerEnvWithMin("RETRIEVAL_TOKEN_LIMIT_PAUSE_MS", 65000, 0);
const concurrencyBaseBackoffMs = parseIntegerEnvWithMin(
  "RETRIEVAL_CONCURRENCY_BACKOFF_MS",
  1200,
  0,
);

const outputFormat = (Bun.env.RETRIEVAL_AUDIT_OUTPUT_FORMAT ?? "pretty").toLowerCase();
const hnswIterativeScanMode =
  Bun.env.RETRIEVAL_HNSW_ITERATIVE_SCAN === "strict_order"
    ? "strict_order"
    : Bun.env.RETRIEVAL_HNSW_ITERATIVE_SCAN === "off"
      ? "off"
      : "relaxed_order";

function toVectorLiteral(vector: number[]): string {
  return `[${vector
    .map((value) => {
      if (!Number.isFinite(value)) {
        throw new Error("Embedding vector contains a non-finite number");
      }
      return value.toFixed(8);
    })
    .join(",")}]`;
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
  const normalizedQuery = normalizeHintText(query);
  return {
    allowExpansion: structuralPattern.test(query),
    articleNumberDigits: extractArticleNumberDigits(query),
    authorityHintNormalized: extractAuthorityHint(query),
    queryNormalized: normalizedQuery,
    hierarchyLevelHint: null,
  };
}

function normalizeArticleNumbers(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits.length === 0 || seen.has(digits)) {
      continue;
    }
    seen.add(digits);
    normalized.push(digits);
  }
  return normalized;
}

function extractArticleNumbersFromIntents(intents: string[]): string[] {
  const allMatches = intents.flatMap((intent) => {
    const matches = intent.matchAll(/\bart[ií]culo\s+(\d+)\b/giu);
    return Array.from(matches, (match) => match[1] ?? "");
  });
  return normalizeArticleNumbers(allMatches);
}

async function prepareLegalMultiSearchInput(
  input: LegalMultiSearchInput,
): Promise<PreparedLegalMultiSearchInput> {
  if (input.intents.length === 0) {
    throw new Error("At least one intent is required");
  }
  if (input.intents.length > 3) {
    throw new Error("A maximum of 3 intents is supported per tool call");
  }

  const normalizedIntents = input.intents
    .map((intent) => normalizeQueryText(intent))
    .filter((intent) => intent.length > 0);

  if (normalizedIntents.length === 0) {
    throw new Error("All intents are empty after normalization");
  }

  const embeddings = await Promise.all(normalizedIntents.map((intent) => embedQuery(intent)));
  const intentScoutVectorLiterals = embeddings.map((embedding) => toVectorLiteral(embedding.scout));
  const primaryRerankVectorLiteral = toVectorLiteral(embeddings[0]?.full ?? []);

  const articleNumbersFromHints = normalizeArticleNumbers(input.structuralHints.articleNumbers);
  const articleNumbers =
    articleNumbersFromHints.length > 0
      ? articleNumbersFromHints
      : extractArticleNumbersFromIntents(normalizedIntents);

  const mergedText = normalizedIntents.join(" ");
  const mergedStrategy = buildRetrievalStrategy(mergedText);

  return {
    intents: normalizedIntents,
    normalizedQuery: mergedStrategy.queryNormalized,
    temporalContext: input.temporalContext,
    structuralHints: {
      articleNumbers,
      hierarchyLevel:
        input.structuralHints.hierarchyLevel && input.structuralHints.hierarchyLevel.length > 0
          ? input.structuralHints.hierarchyLevel
          : null,
    },
    intentScoutVectorLiterals,
    primaryRerankVectorLiteral,
    allowExpansion: mergedStrategy.allowExpansion,
    authorityHintNormalized: mergedStrategy.authorityHintNormalized,
  };
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMilliseconds(nanoseconds: number): number {
  return roundMs(nanoseconds / 1_000_000);
}

function formatMs(valueMs: number): string {
  return `${valueMs.toFixed(2)}ms`;
}

function formatScore(value: number): string {
  return value.toFixed(4);
}

function toBenchmarkStats(stats: MitataRunStats): BenchmarkStats {
  return {
    minMs: toMilliseconds(stats.min),
    p75Ms: toMilliseconds(stats.p75),
    p99Ms: toMilliseconds(stats.p99),
    p999Ms: toMilliseconds(stats.p999),
    maxMs: toMilliseconds(stats.max),
    avgMs: toMilliseconds(stats.avg),
  };
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMitataSummary(input: unknown): MitataSummary {
  if (!isRecord(input)) {
    throw new Error("Mitata did not return a structured benchmark payload");
  }

  const rawBenchmarks = input.benchmarks;
  if (!Array.isArray(rawBenchmarks)) {
    throw new Error("Mitata benchmark payload is missing 'benchmarks'");
  }

  const benchmarks = rawBenchmarks.map((rawBenchmark): MitataBenchmark => {
    if (!isRecord(rawBenchmark) || !Array.isArray(rawBenchmark.runs)) {
      throw new Error("Mitata benchmark entry is missing 'runs'");
    }

    const runs = rawBenchmark.runs.map((rawRun): MitataRunResult => {
      if (!isRecord(rawRun) || typeof rawRun.name !== "string") {
        throw new Error("Mitata run entry is invalid");
      }

      const rawStats = rawRun.stats;
      if (!isRecord(rawStats)) {
        return {
          name: rawRun.name,
          error: rawRun.error,
        };
      }

      const values = {
        avg: rawStats.avg,
        min: rawStats.min,
        p75: rawStats.p75,
        p99: rawStats.p99,
        p999: rawStats.p999,
        max: rawStats.max,
      };

      if (
        typeof values.avg !== "number" ||
        typeof values.min !== "number" ||
        typeof values.p75 !== "number" ||
        typeof values.p99 !== "number" ||
        typeof values.p999 !== "number" ||
        typeof values.max !== "number"
      ) {
        throw new Error(`Mitata stats are incomplete for benchmark '${rawRun.name}'`);
      }

      return {
        name: rawRun.name,
        stats: {
          avg: values.avg,
          min: values.min,
          p75: values.p75,
          p99: values.p99,
          p999: values.p999,
          max: values.max,
        },
        error: rawRun.error,
      };
    });

    return { runs };
  });

  const context = isRecord(input.context) ? input.context : undefined;
  const runtime = typeof context?.runtime === "string" ? context.runtime : undefined;
  const version = typeof context?.version === "string" ? context.version : undefined;
  const arch = typeof context?.arch === "string" ? context.arch : undefined;
  const cpuRecord = isRecord(context?.cpu) ? context.cpu : undefined;

  return {
    benchmarks,
    context: {
      runtime,
      version,
      arch,
      cpu: {
        name: typeof cpuRecord?.name === "string" ? cpuRecord.name : undefined,
        freq: typeof cpuRecord?.freq === "number" ? cpuRecord.freq : undefined,
      },
    },
  };
}

function renderPrettyReport(summaryPayload: MitataSummary, queryResults: QueryAuditResult[]): void {
  const border = "=".repeat(96);
  console.log(ansis.cyan(border));
  console.log(ansis.bold.cyan("Retrieval Audit Report"));

  const context = summaryPayload.context;
  const runtimeText = [context?.runtime, context?.version].filter(Boolean).join(" ").trim();
  const hardwareText = [context?.cpu?.name, context?.arch].filter(Boolean).join(" | ").trim();
  if (runtimeText.length > 0) {
    console.log(`${ansis.gray("Runtime:")} ${ansis.white(runtimeText)}`);
  }
  if (hardwareText.length > 0) {
    console.log(`${ansis.gray("Host:")}    ${ansis.white(hardwareText)}`);
  }

  console.log(ansis.cyan(border));
  console.log(
    `${ansis.bold("Bench Config")} ann=${annCandidates} rerank=${rerankCandidates} seeds=${seedCount} neighbors=${neighborsPerSeed} ef_search=${hnswEfSearch}`,
  );
  console.log(
    `${ansis.bold("Scoring")} citationBoost=${citationExactBoost} citationPenalty=${citationMismatchPenalty} authorityBoost=${authorityHintBoost} authorityPenalty=${authorityMismatchPenalty}`,
  );
  console.log(
    `${ansis.bold("Limits")} maxPerNode=${maxPerNode} finalLimit=${finalLimit} citationCandidates=${citationCandidates} expansionMinRerank=${expansionMinRerank}`,
  );
  console.log(ansis.cyan("-".repeat(96)));

  const title = `${"Tool".padEnd(18)} ${"Scenario".padEnd(34)} ${"Avg".padStart(10)} ${"P75".padStart(10)} ${"P99".padStart(10)} ${"Hits".padStart(6)}`;
  console.log(ansis.bold.white(title));
  console.log(ansis.gray("-".repeat(96)));

  for (const result of queryResults) {
    const scenarioLabel =
      result.scenarioLabel.length > 34
        ? `${result.scenarioLabel.slice(0, 31)}...`
        : result.scenarioLabel;
    const toolLabel = result.toolName.length > 18 ? result.toolName.slice(0, 18) : result.toolName;
    const row = [
      toolLabel.padEnd(18),
      scenarioLabel.padEnd(34),
      formatMs(result.stats.avgMs).padStart(10),
      formatMs(result.stats.p75Ms).padStart(10),
      formatMs(result.stats.p99Ms).padStart(10),
      String(result.hits.length).padStart(6),
    ].join(" ");
    console.log(ansis.white(row));
  }

  console.log(ansis.cyan("-".repeat(96)));
  console.log(ansis.bold("Top Results Snapshot (legal_multisearch)"));

  for (const result of queryResults.filter((item) => item.toolName === "legal_multisearch")) {
    console.log(`- ${ansis.bold(result.scenarioLabel)}`);
    if (result.hits.length === 0) {
      console.log(`  ${ansis.gray("No hits returned")}`);
      continue;
    }

    for (const [index, hit] of result.hits.slice(0, 3).entries()) {
      const nodeLabel = [hit.node_type, hit.node_number].filter(Boolean).join(" ").trim();
      const nodeText = nodeLabel.length > 0 ? nodeLabel : hit.node_path;
      const snippet = hit.snippet.replace(/\s+/g, " ").trim();
      const preview = snippet.length > 132 ? `${snippet.slice(0, 129)}...` : snippet;
      console.log(
        `  ${index + 1}. ${ansis.yellow(hit.canonical_id)} | ${ansis.green(nodeText)} | role=${hit.role} | score=${formatScore(hit.score)}`,
      );
      console.log(`     ${ansis.gray(preview)}`);
    }
  }

  console.log(ansis.cyan(border));
}

function renderJsonReport(queryResults: QueryAuditResult[]): void {
  console.log(
    JSON.stringify(
      {
        config: {
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
        results: queryResults,
      },
      null,
      2,
    ),
  );
}

type PreparedToolScenario = {
  label: string;
  preparedInput: PreparedLegalMultiSearchInput;
  benchmarkNames: Record<RetrievalToolName, string>;
};

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
      NOT $24::boolean
      OR ld.hierarchy_level = $25::hierarchy_level
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
      NOT $24::boolean
      OR ld.hierarchy_level = $25::hierarchy_level
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
    AND (
      NOT $24::boolean
      OR ld.hierarchy_level = $25::hierarchy_level
    )
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
      + (CASE
        WHEN fr.rerank_1024 >= $23::float8 AND $20::text <> '' THEN
          (CASE
            WHEN translate(lower(fr.official_title), 'áéíóúüñ', 'aeiouun') LIKE ('%' || $20::text || '%')
            THEN $21::float8
            ELSE 0
          END)
          + (CASE
            WHEN COALESCE(fr.node_title, '') <> ''
              AND translate(lower(COALESCE(fr.node_title, '')), 'áéíóúüñ', 'aeiouun') LIKE ('%' || $20::text || '%')
            THEN $22::float8
            ELSE 0
          END)
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
  const result = await client.query<SearchHitRow>(fastSql, [
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
    strategy.queryNormalized,
    titleExactBoost,
    nodeTitleExactBoost,
    lexicalBoostRerankFloor,
    strategy.hierarchyLevelHint !== null,
    strategy.hierarchyLevelHint,
  ]);

  return result.rows.map((row) => ({
    ...row,
    rerank_1024: toFiniteNumber(row.rerank_1024, "rerank_1024"),
    semantic_256: toFiniteNumber(row.semantic_256, "semantic_256"),
    hop_distance: toFiniteNumber(row.hop_distance, "hop_distance"),
    score: toFiniteNumber(row.score, "score"),
  }));
}

function toFiniteNumber(value: number | string, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Non-finite numeric value returned for '${label}'`);
  }
  return parsed;
}

function toFiniteIntegerOrNull(value: number | string | null, label: string): number | null {
  if (value === null) {
    return null;
  }
  const numeric = toFiniteNumber(value, label);
  return Math.trunc(numeric);
}

function toSearchHitWithRole(row: SearchHitWithRoleRow): SearchHitWithRole {
  return {
    ...row,
    rerank_1024: toFiniteNumber(row.rerank_1024, "rerank_1024"),
    semantic_256: toFiniteNumber(row.semantic_256, "semantic_256"),
    hop_distance: toFiniteNumber(row.hop_distance, "hop_distance"),
    score: toFiniteNumber(row.score, "score"),
    intent_index: toFiniteIntegerOrNull(row.intent_index, "intent_index"),
  };
}

const polyvectorScoutSql = `
WITH intent_vectors AS (
  SELECT
    (u.ordinality - 1)::int AS intent_index,
    u.vector_text::vector(256) AS vec256
  FROM unnest($1::text[]) WITH ORDINALITY AS u(vector_text, ordinality)
), per_intent_ann AS (
  SELECT
    iv.intent_index,
    ann.fragment_id,
    ann.doc_id,
    ann.version_id,
    ann.canonical_id,
    ann.official_title,
    ann.node_type,
    ann.node_number,
    ann.node_title,
    ann.node_path,
    ann.snippet,
    ann.semantic_256,
    ann.rerank_1024,
    ann.policy_boost
  FROM intent_vectors iv
  JOIN LATERAL (
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
      (1 - (sf.embedding_256 <=> iv.vec256))::float8 AS semantic_256,
      (1 - (sf.embedding_1024 <=> $6::vector(1024)))::float8 AS rerank_1024,
      (
        (CASE
          WHEN COALESCE(sf.valid_from, dv.valid_from, '-infinity'::timestamptz) <= $2::timestamptz
            AND (COALESCE(sf.valid_until, dv.valid_until) IS NULL OR COALESCE(sf.valid_until, dv.valid_until) > $2::timestamptz)
          THEN 0.03
          ELSE 0
        END)
        + (CASE
          WHEN $4::boolean
            AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
          THEN 0.04
          ELSE 0
        END)
        + (CASE
          WHEN $7::boolean AND ld.hierarchy_level = $8::hierarchy_level THEN 0.02
          ELSE 0
        END)
      )::float8 AS policy_boost
    FROM sense_fragments sf
    JOIN legal_documents ld ON ld.doc_id = sf.doc_id
    LEFT JOIN document_versions dv ON dv.version_id = sf.version_id
    WHERE sf.embedding_256 IS NOT NULL
      AND sf.embedding_1024 IS NOT NULL
      AND ld.legislative_stage = 'enacted'
      AND sf.node_type IN ('article', 'paragraph', 'section', 'chapter', 'subsection')
    ORDER BY sf.embedding_256 <=> iv.vec256
    LIMIT $3
  ) ann ON true
), best_by_fragment AS (
  SELECT DISTINCT ON (p.fragment_id)
    p.fragment_id,
    p.doc_id,
    p.version_id,
    p.canonical_id,
    p.official_title,
    p.node_type,
    p.node_number,
    p.node_title,
    p.node_path,
    p.snippet,
    p.rerank_1024,
    p.semantic_256,
    p.policy_boost,
    p.intent_index
  FROM per_intent_ann p
  ORDER BY p.fragment_id, p.semantic_256 DESC, p.rerank_1024 DESC
)
SELECT
  b.fragment_id,
  b.doc_id,
  b.version_id,
  b.canonical_id,
  b.official_title,
  b.node_type,
  b.node_number,
  b.node_title,
  b.node_path,
  b.snippet,
  b.rerank_1024,
  b.semantic_256,
  0::float8 AS hop_distance,
  (
    0.72 * b.rerank_1024
    + 0.24 * b.semantic_256
    + b.policy_boost
    + (CASE
      WHEN $4::boolean
        AND regexp_replace(COALESCE(b.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
      THEN $10::float8
      WHEN $4::boolean AND b.node_type = 'article'
      THEN -$11::float8
      ELSE 0
    END)
  )::float8 AS score,
  'seed'::text AS role,
  b.intent_index,
  NULL::text AS relation_type
FROM best_by_fragment b
ORDER BY score DESC, b.rerank_1024 DESC
LIMIT $9
`;

const temporalStructuralSql = `
WITH ann_candidates AS (
  SELECT
    sf.fragment_id,
    sf.doc_id,
    sf.version_id,
    sf.node_type,
    sf.node_number,
    sf.node_title,
    sf.node_path,
    LEFT(COALESCE(sf.content_normalized, sf.content), 240) AS snippet,
    ld.canonical_id,
    ld.official_title,
    (1 - (sf.embedding_1024 <=> $1::vector(1024)))::float8 AS rerank_1024,
    (1 - (sf.embedding_256 <=> $2::vector(256)))::float8 AS semantic_256,
    (
      (CASE
        WHEN COALESCE(sf.valid_from, dv.valid_from, '-infinity'::timestamptz) <= $3::timestamptz
          AND (COALESCE(sf.valid_until, dv.valid_until) IS NULL OR COALESCE(sf.valid_until, dv.valid_until) > $3::timestamptz)
        THEN 0.03
        ELSE 0
      END)
      + (CASE
        WHEN $4::boolean
          AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
        THEN 0.04
        ELSE 0
      END)
      + (CASE
        WHEN $6::boolean AND ld.hierarchy_level = $7::hierarchy_level THEN 0.02
        ELSE 0
      END)
    )::float8 AS policy_boost
  FROM sense_fragments sf
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  LEFT JOIN document_versions dv ON dv.version_id = sf.version_id
  WHERE sf.embedding_1024 IS NOT NULL
    AND sf.embedding_256 IS NOT NULL
    AND ld.legislative_stage = 'enacted'
    AND sf.node_type IN ('article', 'paragraph', 'section', 'chapter', 'subsection')
  ORDER BY sf.embedding_1024 <=> $1::vector(1024)
  LIMIT ($8 * 6)
)
SELECT
  ac.fragment_id,
  ac.doc_id,
  ac.version_id,
  ac.canonical_id,
  ac.official_title,
  ac.node_type,
  ac.node_number,
  ac.node_title,
  ac.node_path,
  ac.snippet,
  ac.rerank_1024,
  ac.semantic_256,
  0::float8 AS hop_distance,
  (
    ac.rerank_1024 * 0.8
    + ac.semantic_256 * 0.2
    + ac.policy_boost
    + (CASE
      WHEN $4::boolean
        AND regexp_replace(COALESCE(ac.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
      THEN $9::float8
      WHEN $4::boolean AND ac.node_type = 'article'
      THEN -$10::float8
      ELSE 0
    END)
  )::float8 AS score,
  (
    CASE
      WHEN $4::boolean
        AND regexp_replace(COALESCE(ac.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
      THEN 'citation_direct'
      ELSE 'seed'
    END
  )::text AS role,
  NULL::int AS intent_index,
  NULL::text AS relation_type
FROM ann_candidates ac
ORDER BY score DESC
LIMIT $8
`;

const legalMultiSearchSql = `
WITH intent_vectors AS (
  SELECT
    (u.ordinality - 1)::int AS intent_index,
    u.vector_text::vector(256) AS vec256
  FROM unnest($1::text[]) WITH ORDINALITY AS u(vector_text, ordinality)
), per_intent_ann AS (
  SELECT
    iv.intent_index,
    ann.fragment_id,
    ann.doc_id,
    ann.version_id,
    ann.node_path_ltree,
    ann.legal_node_path_ltree,
    ann.sequence_index,
    ann.semantic_256,
    ann.policy_boost
  FROM intent_vectors iv
  JOIN LATERAL (
    SELECT
      sf.fragment_id,
      sf.doc_id,
      sf.version_id,
      sf.node_path_ltree,
      sf.legal_node_path_ltree,
      sf.sequence_index,
      (1 - (sf.embedding_256 <=> iv.vec256))::float8 AS semantic_256,
      (
        (CASE
          WHEN COALESCE(sf.valid_from, dv.valid_from, '-infinity'::timestamptz) <= $2::timestamptz
            AND (COALESCE(sf.valid_until, dv.valid_until) IS NULL OR COALESCE(sf.valid_until, dv.valid_until) > $2::timestamptz)
          THEN 0.03
          ELSE 0
        END)
        + (CASE
          WHEN $4::boolean
            AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
          THEN 0.04
          ELSE 0
        END)
        + (CASE
          WHEN $6::boolean AND ld.hierarchy_level = $7::hierarchy_level THEN 0.02
          ELSE 0
        END)
      )::float8 AS policy_boost
    FROM sense_fragments sf
    JOIN legal_documents ld ON ld.doc_id = sf.doc_id
    LEFT JOIN document_versions dv ON dv.version_id = sf.version_id
    WHERE sf.embedding_256 IS NOT NULL
      AND sf.embedding_1024 IS NOT NULL
      AND ld.legislative_stage = 'enacted'
      AND sf.node_type IN ('article', 'paragraph', 'section', 'chapter', 'subsection')
    ORDER BY sf.embedding_256 <=> iv.vec256
    LIMIT $8
  ) ann ON true
), polyvector_ann AS (
  SELECT DISTINCT ON (fragment_id)
    p.fragment_id,
    p.doc_id,
    p.version_id,
    p.node_path_ltree,
    p.legal_node_path_ltree,
    p.sequence_index,
    p.semantic_256,
    p.policy_boost,
    p.intent_index
  FROM per_intent_ann p
  ORDER BY p.fragment_id, p.semantic_256 DESC
), structural_matches AS (
  SELECT
    sf.fragment_id,
    sf.doc_id,
    sf.version_id,
    sf.node_path_ltree,
    sf.legal_node_path_ltree,
    sf.sequence_index,
    1::float8 AS semantic_256,
    0::float8 AS policy_boost,
    NULL::int AS intent_index
  FROM sense_fragments sf
  JOIN legal_documents ld ON ld.doc_id = sf.doc_id
  LEFT JOIN document_versions dv ON dv.version_id = sf.version_id
  WHERE $4::boolean
    AND sf.embedding_256 IS NOT NULL
    AND sf.embedding_1024 IS NOT NULL
    AND ld.legislative_stage = 'enacted'
    AND (COALESCE(sf.valid_from, dv.valid_from, '-infinity'::timestamptz) <= $2::timestamptz)
    AND (COALESCE(sf.valid_until, dv.valid_until) IS NULL OR COALESCE(sf.valid_until, dv.valid_until) > $2::timestamptz)
    AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
    AND (
      NOT $6::boolean
      OR ld.hierarchy_level = $7::hierarchy_level
    )
  ORDER BY sf.sequence_index ASC
  LIMIT $9
), base_candidates AS (
  SELECT DISTINCT ON (fragment_id)
    c.fragment_id,
    c.doc_id,
    c.version_id,
    c.node_path_ltree,
    c.legal_node_path_ltree,
    c.sequence_index,
    c.semantic_256,
    c.policy_boost,
    c.intent_index
  FROM (
    SELECT * FROM polyvector_ann
    UNION ALL
    SELECT * FROM structural_matches
  ) c
  ORDER BY c.fragment_id, c.semantic_256 DESC
), reranked AS (
  SELECT
    bc.fragment_id,
    bc.doc_id,
    bc.version_id,
    bc.node_path_ltree,
    bc.legal_node_path_ltree,
    bc.sequence_index,
    bc.semantic_256,
    bc.policy_boost,
    bc.intent_index,
    (1 - (sf.embedding_1024 <=> $3::vector(1024)))::float8 AS rerank_1024,
    (
      0.72 * (1 - (sf.embedding_1024 <=> $3::vector(1024)))
      + 0.20 * bc.semantic_256
      + COALESCE(bc.policy_boost, 0::float8)
      + (CASE
        WHEN $6::boolean THEN
          CASE
            WHEN ld2.hierarchy_level = $7::hierarchy_level THEN 0.12
            ELSE -0.08
          END
        ELSE 0
      END)
      + (CASE
        WHEN $4::boolean
          AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
        THEN $15::float8
        WHEN $4::boolean AND sf.node_type = 'article'
        THEN -$16::float8
        ELSE 0
      END)
    )::float8 AS pre_rank_score,
    ROW_NUMBER() OVER (
      ORDER BY
        (
          0.72 * (1 - (sf.embedding_1024 <=> $3::vector(1024)))
          + 0.20 * bc.semantic_256
          + COALESCE(bc.policy_boost, 0::float8)
          + (CASE
            WHEN $6::boolean THEN
              CASE
                WHEN ld2.hierarchy_level = $7::hierarchy_level THEN 0.12
                ELSE -0.08
              END
            ELSE 0
          END)
          + (CASE
            WHEN $4::boolean
              AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
            THEN $15::float8
            WHEN $4::boolean AND sf.node_type = 'article'
            THEN -$16::float8
            ELSE 0
          END)
        ) DESC,
        sf.embedding_1024 <=> $3::vector(1024)
    )::int AS rerank_rank
  FROM base_candidates bc
  JOIN sense_fragments sf ON sf.fragment_id = bc.fragment_id
  JOIN legal_documents ld2 ON ld2.doc_id = bc.doc_id
  ORDER BY pre_rank_score DESC, sf.embedding_1024 <=> $3::vector(1024)
  LIMIT $10
), seed_top AS (
  SELECT *
  FROM reranked
  WHERE rerank_rank <= $11
), expanded_ltree AS (
  SELECT
    x.fragment_id,
    CASE
      WHEN x.node_path_ltree @> st.node_path_ltree THEN 'parent'
      WHEN x.node_path_ltree <@ st.node_path_ltree THEN 'child'
      ELSE 'sibling'
    END::text AS role
  FROM seed_top st
  JOIN LATERAL (
    SELECT
      sf2.fragment_id,
      sf2.node_path_ltree,
      sf2.sequence_index
    FROM sense_fragments sf2
    WHERE sf2.doc_id = st.doc_id
      AND sf2.version_id = st.version_id
      AND sf2.fragment_id <> st.fragment_id
      AND (
        sf2.node_path_ltree @> st.node_path_ltree
        OR sf2.node_path_ltree <@ st.node_path_ltree
        OR (
          nlevel(sf2.node_path_ltree) = nlevel(st.node_path_ltree)
          AND subpath(sf2.node_path_ltree, 0, nlevel(sf2.node_path_ltree) - 1)
              = subpath(st.node_path_ltree, 0, nlevel(st.node_path_ltree) - 1)
        )
      )
    ORDER BY ABS(sf2.sequence_index - st.sequence_index) ASC
    LIMIT $12
  ) x ON $13::boolean
), expanded_references AS (
  SELECT
    ra.source_fragment_id AS fragment_id,
    'legal_reference'::text AS role,
    ra.relation_type::text AS relation_type
  FROM seed_top st
  JOIN legal_documents ld ON ld.doc_id = st.doc_id
  JOIN reference_anchors ra ON ra.target_canonical_id = ld.canonical_id
  WHERE st.rerank_rank <= $11
    AND ra.relation_type IN ('deroga_total', 'deroga_parcial', 'modifica')
    AND ra.source_fragment_id IS NOT NULL
), final_set AS (
  SELECT st.fragment_id, 'seed'::text AS role, NULL::text AS relation_type, 0::int AS role_priority FROM seed_top st
  UNION
  SELECT el.fragment_id, el.role, NULL::text AS relation_type, 1::int AS role_priority FROM expanded_ltree el
  UNION
  SELECT er.fragment_id, er.role, er.relation_type, 2::int AS role_priority FROM expanded_references er
), dedup AS (
  SELECT DISTINCT ON (fragment_id)
    fs.fragment_id,
    fs.role,
    fs.relation_type
  FROM final_set fs
  ORDER BY fs.fragment_id, fs.role_priority ASC
)
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
  (1 - (sf.embedding_1024 <=> $3::vector(1024)))::float8 AS rerank_1024,
  COALESCE(r.semantic_256, 0::float8) AS semantic_256,
  CASE
    WHEN d.role = 'seed' THEN 0::float8
    WHEN d.role = 'parent' OR d.role = 'child' OR d.role = 'sibling' THEN 1::float8
    ELSE 2::float8
  END AS hop_distance,
  (
    0.72 * (1 - (sf.embedding_1024 <=> $3::vector(1024)))
    + 0.20 * COALESCE(r.semantic_256, 0::float8)
    + COALESCE(r.policy_boost, 0::float8)
    + (CASE
      WHEN $6::boolean THEN
        CASE
          WHEN ld.hierarchy_level = $7::hierarchy_level THEN 0.12
          ELSE -0.08
        END
      ELSE 0
    END)
    + (CASE
      WHEN $4::boolean
        AND regexp_replace(COALESCE(sf.node_number, ''), '[^0-9]', '', 'g') = ANY($5::text[])
      THEN $15::float8
      WHEN $4::boolean AND sf.node_type = 'article'
      THEN -$16::float8
      ELSE 0
    END)
    + CASE
      WHEN d.role = 'seed' THEN 0.08
      WHEN d.role = 'legal_reference' THEN 0.06
      ELSE 0.04
    END
  )::float8 AS score,
  d.role,
  r.intent_index,
  d.relation_type
FROM dedup d
JOIN sense_fragments sf ON sf.fragment_id = d.fragment_id
JOIN legal_documents ld ON ld.doc_id = sf.doc_id
LEFT JOIN reranked r ON r.fragment_id = sf.fragment_id
ORDER BY score DESC, rerank_1024 DESC
LIMIT $14
`;

async function executePolyvectorScoutTool(
  client: Client,
  input: PreparedLegalMultiSearchInput,
): Promise<SearchHitWithRole[]> {
  const rows = await client.query<SearchHitWithRoleRow>(polyvectorScoutSql, [
    input.intentScoutVectorLiterals,
    input.temporalContext.toISOString(),
    annCandidates,
    input.structuralHints.articleNumbers.length > 0,
    input.structuralHints.articleNumbers,
    input.primaryRerankVectorLiteral,
    input.structuralHints.hierarchyLevel !== null,
    input.structuralHints.hierarchyLevel,
    finalLimit,
    strictArticleExactBoost,
    strictArticleMismatchPenalty,
  ]);
  return rows.rows.map(toSearchHitWithRole);
}

async function executeTemporalStructuralTool(
  client: Client,
  input: PreparedLegalMultiSearchInput,
): Promise<SearchHitWithRole[]> {
  const primaryScout = input.intentScoutVectorLiterals[0];
  if (!primaryScout) {
    return [];
  }

  const rows = await client.query<SearchHitWithRoleRow>(temporalStructuralSql, [
    input.primaryRerankVectorLiteral,
    primaryScout,
    input.temporalContext.toISOString(),
    input.structuralHints.articleNumbers.length > 0,
    input.structuralHints.articleNumbers,
    input.structuralHints.hierarchyLevel !== null,
    input.structuralHints.hierarchyLevel,
    finalLimit,
    strictArticleExactBoost,
    strictArticleMismatchPenalty,
  ]);
  return rows.rows.map(toSearchHitWithRole);
}

async function executeContextExpansionTool(
  client: Client,
  input: PreparedLegalMultiSearchInput,
): Promise<SearchHitWithRole[]> {
  const primaryScout = input.intentScoutVectorLiterals[0];
  if (!primaryScout) {
    return [];
  }

  const strategy: RetrievalStrategy = {
    allowExpansion: input.allowExpansion,
    articleNumberDigits: input.structuralHints.articleNumbers[0] ?? null,
    authorityHintNormalized: input.authorityHintNormalized,
    queryNormalized: input.normalizedQuery,
    hierarchyLevelHint: input.structuralHints.hierarchyLevel,
  };

  const hits = await runFastQuery(client, primaryScout, input.primaryRerankVectorLiteral, strategy);
  return hits.map((hit) => ({
    ...hit,
    role: hit.hop_distance <= 0 ? "seed" : hit.hop_distance <= 1 ? "sibling" : "context",
    intent_index: null,
    relation_type: null,
  }));
}

async function executeLegalMultiSearchTool(
  client: Client,
  input: PreparedLegalMultiSearchInput,
): Promise<SearchHitWithRole[]> {
  const rows = await client.query<SearchHitWithRoleRow>(legalMultiSearchSql, [
    input.intentScoutVectorLiterals,
    input.temporalContext.toISOString(),
    input.primaryRerankVectorLiteral,
    input.structuralHints.articleNumbers.length > 0,
    input.structuralHints.articleNumbers,
    input.structuralHints.hierarchyLevel !== null,
    input.structuralHints.hierarchyLevel,
    annCandidates,
    citationCandidates,
    rerankCandidates,
    seedCount,
    neighborsPerSeed,
    input.allowExpansion,
    finalLimit,
    strictArticleExactBoost,
    strictArticleMismatchPenalty,
  ]);
  return rows.rows.map(toSearchHitWithRole);
}

async function executeRetrievalTool(
  client: Client,
  toolName: RetrievalToolName,
  input: PreparedLegalMultiSearchInput,
): Promise<SearchHitWithRole[]> {
  switch (toolName) {
    case "polyvector_scout":
      return executePolyvectorScoutTool(client, input);
    case "temporal_structural":
      return executeTemporalStructuralTool(client, input);
    case "context_expansion":
      return executeContextExpansionTool(client, input);
    case "legal_multisearch":
      return executeLegalMultiSearchTool(client, input);
    default:
      return [];
  }
}

async function main() {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`SET hnsw.ef_search = ${hnswEfSearch}`);
    if (hnswIterativeScanMode !== "off") {
      await client.query(`SET hnsw.iterative_scan = '${hnswIterativeScanMode}'`);
    }

    const preparedScenarios: PreparedToolScenario[] = await Promise.all(
      toolScenarios.map(async (scenario, index) => {
        const preparedInput = await prepareLegalMultiSearchInput(scenario.input);
        return {
          label: scenario.label,
          preparedInput,
          benchmarkNames: {
            polyvector_scout: `S${index + 1} polyvector_scout: ${scenario.label}`,
            temporal_structural: `S${index + 1} temporal_structural: ${scenario.label}`,
            context_expansion: `S${index + 1} context_expansion: ${scenario.label}`,
            legal_multisearch: `S${index + 1} legal_multisearch: ${scenario.label}`,
          },
        };
      }),
    );

    const benchmarkDefinitions = preparedScenarios.flatMap((scenario) => {
      const tools: RetrievalToolName[] = [
        "polyvector_scout",
        "temporal_structural",
        "context_expansion",
        "legal_multisearch",
      ];
      return tools.map((toolName) => ({
        benchmarkName: scenario.benchmarkNames[toolName],
        toolName,
        scenarioLabel: scenario.label,
        preparedInput: scenario.preparedInput,
      }));
    });

    const latestHitsByBenchmarkName = new Map<string, SearchHitWithRole[]>();

    group("retrieval_tools", () => {
      barplot(() => {
        boxplot(() => {
          summary(() => {
            for (const definition of benchmarkDefinitions) {
              bench(definition.benchmarkName, async () => {
                const hits = await executeRetrievalTool(
                  client,
                  definition.toolName,
                  definition.preparedInput,
                );
                latestHitsByBenchmarkName.set(definition.benchmarkName, hits);
              });
            }
          });
        });
      });
    });

    const rawSummary =
      outputFormat === "json"
        ? await run({
            format: "json",
            colors: false,
            print: () => {},
          })
        : await run({
            format: "mitata",
            colors: true,
          });

    const summaryPayload = parseMitataSummary(rawSummary);
    const statsByBenchmarkName = new Map<string, BenchmarkStats>();
    const errorsByBenchmarkName = new Map<string, string>();
    for (const benchmark of summaryPayload.benchmarks) {
      for (const runResult of benchmark.runs) {
        if (runResult.stats) {
          statsByBenchmarkName.set(runResult.name, toBenchmarkStats(runResult.stats));
        } else if (runResult.error !== undefined) {
          errorsByBenchmarkName.set(runResult.name, formatUnknownError(runResult.error));
        }
      }
    }

    const queryResults: QueryAuditResult[] = benchmarkDefinitions.map((definition) => {
      const stats = statsByBenchmarkName.get(definition.benchmarkName);
      if (!stats) {
        const benchmarkError = errorsByBenchmarkName.get(definition.benchmarkName);
        if (benchmarkError) {
          throw new Error(
            `Mitata benchmark '${definition.benchmarkName}' failed: ${benchmarkError}`,
          );
        }
        throw new Error(`Missing mitata stats for benchmark '${definition.benchmarkName}'`);
      }

      return {
        benchmarkName: definition.benchmarkName,
        toolName: definition.toolName,
        scenarioLabel: definition.scenarioLabel,
        stats,
        hits: latestHitsByBenchmarkName.get(definition.benchmarkName) ?? [],
      };
    });

    if (outputFormat === "json") {
      renderJsonReport(queryResults);
    } else {
      renderPrettyReport(summaryPayload, queryResults);
    }
  } finally {
    await client.end();
  }
}

await main();
