# Retrieval Learnings (Project Notes)

## 1) Current retrieval shape that works best here

The most effective pattern in this project is a two-stage vector pipeline:

1. **Fast candidate generation on `embedding_256`** (cheap ANN-style shortlist).
2. **Precise reranking on `embedding_1024`** (quality pass on a small set).

This is materially better than trying to rank everything with `embedding_1024` directly.

## 2) Why `256 -> 1024` is the right split

- `embedding_256` is fast enough for broad candidate recall.
- `embedding_1024` gives better semantic ordering and should be used only on a bounded subset.
- Small-stage then precise-stage avoids expensive full-corpus high-dimensional scoring.

## 3) Ltree for multi-hop context (without blowing latency)

`sense_fragments` has structural and legal hierarchy paths (`node_path_ltree`, `legal_node_path_ltree`) with GiST indexes. The useful pattern is:

- pick a **small seed set** after vector rerank,
- do **bounded lateral expansion** around each seed (parent/child/sibling/legal-ancestor matches),
- cap neighbors per seed to prevent fan-out explosions.

This preserves context links for legal reasoning while keeping query cost predictable.

## 4) What hurt latency the most

The slow versions were caused by over-wide pipelines:

- too many candidates before rerank,
- too many CTE branches with large unions,
- unbounded or high-cardinality ltree expansion,
- lexical ranking in the hot path over large sets.

Latency dropped once candidate counts and ltree expansion were aggressively capped.

## 5) Practical query strategy for this repo

Low-latency strategy:

- ANN shortlist on `embedding_256` (small K)
- rerank only top M using `embedding_1024`
- ltree expansion only from top S seeds, with strict per-seed limit
- final score = mostly rerank score + smaller contributions from scout score + hop bonus/penalty

If latency is the priority, lexical fusion should be reduced or moved out of the critical path.

## 6) Real performance observation

For DB retrieval alone (excluding query embedding generation), the optimized pipeline can run in low single-digit milliseconds on warm runs. End-to-end latency is dominated by embedding API time and external rate limits.

## 7) External API realities (critical)

The embedding provider can throttle by:

- **concurrency limit**
- **token-per-minute limit**

A robust query embedding client must distinguish those cases and back off differently:

- concurrency limit -> exponential backoff with jitter
- token limit -> longer cooldown (near window reset)

## 8) Retrieval quality observations

- Constitutional/fundamental-rights queries retrieved highly relevant constitutional fragments once rerank was dominant.
- Competence/regulatory-power queries improved when candidate set was broad enough but rerank remained tight.
- Derogation/final-provision queries benefit from structural expansion because relevant clauses cluster in closing sections.

## 9) Tuning knobs that matter most

Primary knobs for speed/relevance tradeoff:

- ANN candidate count (`embedding_256` stage)
- rerank candidate count (`embedding_1024` stage)
- seed count for ltree expansion
- neighbors per seed for ltree expansion
- pgvector HNSW search settings (`hnsw.ef_search`)

## 10) Operational guidance

- Measure DB retrieval latency separately from embedding latency.
- Keep retrieval SQL bounded and deterministic.
- Treat ltree expansion as contextual augmentation, not a broad discovery step.
- Prefer predictable p90 over occasional high-recall spikes.
