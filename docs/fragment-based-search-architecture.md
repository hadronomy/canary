# Fragment-Based Semantic Search Architecture

## Executive Summary

This document proposes a comprehensive architecture for implementing semantic search at the **fragment level** (sections, articles, paragraphs) rather than document level. This enables precise highlighting of relevant content in the UI and significantly improves search relevance for legal documents.

---

## 1. Core Concepts

### 1.1 What Are Fragments?

Fragments are semantic, addressable units of a legal document:

| Fragment Type | Example                         | Use Case               |
| ------------- | ------------------------------- | ---------------------- |
| **Document**  | Full BOE law                    | Overview, metadata     |
| **Chapter**   | "Chapter I: General Provisions" | Thematic grouping      |
| **Article**   | "Article 5. Definitions"        | Primary legal unit     |
| **Section**   | "Section 3.2: Liability"        | Subdivision of article |
| **Paragraph** | Individual numbered paragraph   | Precise citation       |

### 1.2 Why Fragment-Level Search?

**Document-level search problems:**

- Returns entire 50-page documents for a single relevant sentence
- No ability to highlight specific relevant text
- Poor ranking (long documents dilute relevance scores)

**Fragment-level benefits:**

- ✅ Returns exact relevant paragraphs/articles
- ✅ Enables precise UI highlighting
- ✅ Better relevance scoring (focused content)
- ✅ Supports "find similar sections" functionality
- ✅ Enables citation and linking to specific fragments

---

## 2. Database Schema Architecture

### 2.1 Existing Foundation

The `sense_fragments` table is already designed for this:

```typescript
// packages/db/src/schema/legislation.ts
export const senseFragments = pgTable("sense_fragments", {
  fragmentId: uuid("fragment_id").primaryKey(),
  docId: uuid("doc_id").references(() => legalDocuments.docId),
  versionId: uuid("version_id").references(() => documentVersions.versionId),

  // Content & Structure
  content: text("content").notNull(),
  contentNormalized: text("content_normalized"),
  nodePath: varchar("node_path", { length: 500 }).notNull(), // e.g., "/1/3/2"
  nodeType: nodeTypeEnum("node_type").notNull(), // "article", "section"
  nodeNumber: varchar("node_number"), // "5", "3.2"
  nodeTitle: varchar("node_title"), // "Definitions"

  // Embeddings
  embedding1024: vector("embedding_1024", { dimensions: 1024 }), // Full embedding
  embedding256: vector("embedding_256", { dimensions: 256 }), // Scout/fast

  // Context for UI
  precedingContext: text("preceding_context"), // Text before fragment
  followingContext: text("following_context"), // Text after fragment

  // Metadata
  validFrom: timestamp("valid_from"),
  validUntil: timestamp("valid_until"),
  contentFingerprint: varchar("content_fingerprint", { length: 64 }),

  // Performance
  tokenCount: integer("token_count"),
  charCount: integer("char_count"),
  sequenceIndex: integer("sequence_index"),
});
```

### 2.2 Node Path Structure

```typescript
// Hierarchical addressing scheme
const nodePathExamples = {
  document: "/", // Root
  chapter: "/1", // Chapter 1
  article: "/1/5", // Chapter 1, Article 5
  section: "/1/5/2", // Chapter 1, Article 5, Section 2
  paragraph: "/1/5/2/3", // ...Paragraph 3
};

// Benefits:
// - Lexicographic sort = document order
// - Parent lookup: path.substring(0, path.lastIndexOf('/'))
// - Children query: WHERE node_path LIKE '/1/5/%'
```

### 2.3 Index Strategy

```sql
-- Vector similarity (HNSW = fast approximate search)
CREATE INDEX idx_frag_1024_hnsw ON sense_fragments
USING hnsw (embedding_1024 vector_cosine_ops)
WITH (m=16, ef_construction=64);

-- Exact matches and filtering
CREATE INDEX idx_frag_doc ON sense_fragments(doc_id);
CREATE INDEX idx_frag_type ON sense_fragments(node_type);
CREATE INDEX idx_frag_valid ON sense_fragments(valid_from, valid_until);

-- Full-text search (for hybrid search)
CREATE INDEX idx_frag_content_fts ON sense_fragments
USING gin(to_tsvector('spanish', content));
```

---

## 3. Proposed Effect Architectures

### 3.1 Architecture A: Layered Service Composition

**Best for**: Complex applications with multiple embedding providers

```typescript
// services/fragment-embedding/service.ts
import { Effect, Layer } from "effect";
import { EmbeddingService } from "~/services/embedding";
import { DatabaseService } from "@canary/db/effect";

// Domain models
export interface Fragment {
  readonly content: string;
  readonly nodePath: string;
  readonly nodeType: string;
  readonly nodeTitle?: string;
}

export interface EmbeddedFragment extends Fragment {
  readonly embedding: number[];
  readonly embedding256: number[];
  readonly contentFingerprint: string;
}

// Service definition
export class FragmentEmbeddingService extends Effect.Service<FragmentEmbeddingService>()(
  "FragmentEmbeddingService",
  {
    dependencies: [EmbeddingService.Default, DatabaseService.Default],
    effect: Effect.gen(function* () {
      const embedding = yield* EmbeddingService;
      const db = yield* DatabaseService;

      // ───────────────────────────────────────
      // Core Operations
      // ───────────────────────────────────────

      const embedFragment = Effect.fn("FragmentEmbedding.embedFragment")((fragment: Fragment) =>
        Effect.gen(function* () {
          // Use Jina's late_chunking for multi-vector per document
          const result = yield* embedding.embed(fragment.content);

          // Handle both single and multi-vector results
          if (Array.isArray(result)) {
            // Multiple vectors (late_chunking returned chunks)
            return result.map((emb, idx) => ({
              ...fragment,
              embedding: emb.full!,
              embedding256: emb.scout!,
              nodePath: `${fragment.nodePath}/${idx}`,
              contentFingerprint: createHash(fragment.content),
            }));
          }

          // Single vector
          return [
            {
              ...fragment,
              embedding: result.full!,
              embedding256: result.scout!,
              contentFingerprint: createHash(fragment.content),
            },
          ];
        }),
      );

      const embedFragments = Effect.fn("FragmentEmbedding.embedFragments")(
        (fragments: Fragment[]) =>
          // Process in batches with concurrency control
          Effect.forEach(fragments, embedFragment, {
            concurrency: 5, // Jina rate limit consideration
            batching: true,
          }).pipe(Effect.map((results) => results.flat())),
      );

      const storeFragments = Effect.fn("FragmentEmbedding.storeFragments")(
        (fragments: EmbeddedFragment[], docId: string, versionId: string) =>
          Effect.gen(function* () {
            // Batch insert with conflict handling
            const values = fragments.map((f, idx) => ({
              docId,
              versionId,
              content: f.content,
              nodePath: f.nodePath,
              nodeType: f.nodeType,
              nodeTitle: f.nodeTitle,
              embedding1024: f.embedding,
              embedding256: f.embedding256,
              contentFingerprint: f.contentFingerprint,
              sequenceIndex: idx,
            }));

            return yield* db
              .insert(senseFragments)
              .values(values)
              .onConflictDoUpdate({
                target: [senseFragments.docId, senseFragments.contentFingerprint],
                set: {
                  embedding1024: sql`excluded.embedding_1024`,
                  embedding256: sql`excluded.embedding_256`,
                  updatedAt: sql`now()`,
                },
              });
          }),
      );

      return {
        embedFragment,
        embedFragments,
        storeFragments,
      };
    }),
  },
) {}
```

**Benefits:**

- ✅ Clear separation of concerns
- ✅ Jina service is swappable (test/mock layers)
- ✅ Database operations isolated
- ✅ Reusable across collectors

**Usage:**

```typescript
const program = Effect.gen(function* () {
  const embedder = yield* FragmentEmbeddingService;

  const fragments = parseDocument(content);
  const embedded = yield* embedder.embedFragments(fragments);
  yield* embedder.storeFragments(embedded, docId, versionId);
});
```

---

### 3.2 Architecture B: Pipeline-Based Processing

**Best for**: Stream processing, large document collections

```typescript
// services/fragment-processing/pipeline.ts
import { Effect, Stream, Schedule, Chunk } from "effect";

export class FragmentPipeline extends Effect.Service<FragmentPipeline>()(
  "FragmentPipeline",
  {
    dependencies: [EmbeddingService.Default, DatabaseService.Default],
    effect: Effect.gen(function* () {
      const embedding = yield* EmbeddingService;
      const db = yield* DatabaseService;

      // ───────────────────────────────────────
      // Stream-Based Processing
      // ───────────────────────────────────────

      const createEmbeddingStream = (
        documentStream: Stream.Stream<Document, CollectionError>
      ): Stream.Stream<EmbeddedFragment, CollectionError> =>
        documentStream.pipe(
          // Parse documents into fragments
          Stream.mapEffect((doc) => parseDocumentIntoFragments(doc), {
            concurrency: 10,
          }),

          // Flatten fragments into individual items
          Stream.flatMap((fragments) => Stream.fromIterable(fragments)),

          // Group into batches for efficient API usage
          Stream.grouped(10), // Jina supports batching

          // Embed batches
          Stream.mapEffect((batch) =>
            Effect.gen(function* () {
              const contents = Chunk.toArray(batch).map((f) => f.content);
              const embeddings = yield* embedding.embed(contents);

              return Chunk.map(batch, (fragment, idx) => ({
                ...fragment,
                embedding: embeddings[idx].full,
                embedding256: embeddings[idx].scout,
              }));
            }).pipe(
              Effect.retry({
                schedule: Schedule.exponential("100 millis").pipe(
                  Schedule.intersect(Schedule.recurs(3))
                ),
              }),
              Effect.mapError((e) => new CollectionError({...}))
            ),
            { concurrency: 3 }
          ),

          // Flatten batches back to individual fragments
          Stream.flatMap((batch) => Stream.fromIterable(batch)),

          // Persist to database
          Stream.mapEffect((fragment) =>
            db.insert(senseFragments).values({...}),
            { concurrency: 10 }
          ),

          // Add metrics
          Stream.tap((_) => Effect.log("Fragment embedded and stored")),

          // Handle errors without stopping pipeline
          Stream.catchAll((error) =>
            Stream.fromEffect(
              Effect.logError("Pipeline error", error).pipe(
                Effect.as(Stream.empty())
              )
            )
          )
        );

      return { createEmbeddingStream };
    }),
  }
) {};

// Usage in collector
const runPipeline = Effect.gen(function* () {
  const pipeline = yield* FragmentPipeline;

  const documentStream = Stream.fromIterable(documents);

  yield* pipeline
    .createEmbeddingStream(documentStream)
    .pipe(Stream.runDrain);
});
```

**Benefits:**

- ✅ Memory-efficient for large collections
- ✅ Built-in backpressure handling
- ✅ Observable progress (stream metrics)
- ✅ Resilient to individual failures

---

### 3.3 Architecture C: Workflow-Based (for Complex Processing)

**Best for**: Multi-stage processing with dependencies

```typescript
// services/fragment-workflow/activities.ts
import { Effect } from "effect";
import { Workflow } from "@effect/cluster";

// Activity definitions
const parseFragmentActivity = Workflow.makeActivity({
  name: "parseFragment",
  execute: (doc: Document) => Effect.sync(() => parseDocumentIntoFragments(doc)),
});

const embedFragmentActivity = Workflow.makeActivity({
  name: "embedFragment",
  execute: (fragments: Fragment[]) =>
    Effect.gen(function* () {
      const embedding = yield* EmbeddingService;
      return yield* embedding.embed(fragments.map((f) => f.content));
    }),
  retryPolicy: Schedule.exponential("100 millis").pipe(Schedule.intersect(Schedule.recurs(3))),
});

const storeFragmentActivity = Workflow.makeActivity({
  name: "storeFragment",
  execute: (embedded: EmbeddedFragment[]) =>
    Effect.gen(function* () {
      const db = yield* DatabaseService;
      yield* db.insert(senseFragments).values(embedded);
    }),
});

// Workflow composition
const embedDocumentWorkflow = Workflow.make("embedDocument")(
  Effect.fn(function* (docId: string) {
    // 1. Fetch document
    const doc = yield* fetchDocumentActivity(docId);

    // 2. Parse into fragments
    const fragments = yield* parseFragmentActivity(doc);

    // 3. Embed in batches
    const embedded = yield* embedFragmentActivity(fragments);

    // 4. Store results
    yield* storeFragmentActivity(fragments.map((f, i) => ({ ...f, embedding: embedded[i] })));

    return { fragmentCount: fragments.length };
  }),
);
```

**Benefits:**

- ✅ Durable execution (resumes after crashes)
- ✅ Built-in observability
- ✅ Can distribute across workers
- ✅ Saga pattern for compensation

---

## 4. Fragment Parser Implementation

### 4.1 Legal Document Parser

```typescript
// services/fragment-parser/legal-parser.ts
import { Effect, Schema } from "effect";

// Schema for structured legal documents
const LegalNodeSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("document"),
    title: Schema.String,
    children: Schema.Array(Schema.suspend(() => LegalNodeSchema)),
  }),
  Schema.Struct({
    type: Schema.Literal("chapter"),
    number: Schema.String,
    title: Schema.String,
    children: Schema.Array(Schema.suspend(() => LegalNodeSchema)),
  }),
  Schema.Struct({
    type: Schema.Literal("article"),
    number: Schema.String,
    title: Schema.optional(Schema.String),
    content: Schema.String,
    children: Schema.Array(Schema.suspend(() => LegalNodeSchema)),
  }),
  Schema.Struct({
    type: Schema.Literal("paragraph"),
    number: Schema.String,
    content: Schema.String,
  }),
);

export class LegalFragmentParser extends Effect.Service<LegalFragmentParser>()(
  "LegalFragmentParser",
  {
    effect: Effect.sync(() => {
      const parseBoeDocument = Effect.fn("LegalParser.parseBoe")(
        (content: string, metadata: BoeMetadata) =>
          Effect.gen(function* () {
            // Parse XML/HTML structure
            const document = yield* parseXml(content);

            // Extract fragments recursively
            const fragments: Fragment[] = [];

            const traverse = (
              node: LegalNode,
              parentPath: string = "",
              depth: number = 0,
            ): void => {
              const currentPath = parentPath ? `${parentPath}/${getNodeIndex(node)}` : "/";

              if (node.type === "article" || node.type === "paragraph") {
                fragments.push({
                  content: node.content,
                  nodePath: currentPath,
                  nodeType: node.type,
                  nodeNumber: node.number,
                  nodeTitle: node.title,
                  // Extract context (parent + siblings)
                  precedingContext: getPrecedingText(node),
                  followingContext: getFollowingText(node),
                });
              }

              // Recurse into children
              if ("children" in node) {
                node.children.forEach((child) => traverse(child, currentPath, depth + 1));
              }
            };

            traverse(document);
            return fragments;
          }),
      );

      return { parseBoeDocument };
    }),
  },
) {}
```

### 4.2 Chunking Strategies

```typescript
// utils/chunking-strategies.ts

// Strategy 1: Late Chunking (Jina native)
// Pros: Best semantic coherence, Cons: Requires API support
const lateChunkingStrategy = (document: string, maxChunkSize: number = 512): string[] => {
  // Jina handles chunking internally when late_chunking=true
  // We just split by max token size for API limits
  return splitByTokenCount(document, maxChunkSize);
};

// Strategy 2: Semantic Paragraph Splitting
// Pros: Preserves meaning boundaries
const semanticChunkingStrategy = (document: string): string[] => {
  // Split by double newlines (paragraphs)
  const paragraphs = document.split(/\n\s*\n/);

  // Merge short paragraphs with next
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length < 1000) {
      currentChunk += "\n\n" + para;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = para;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
};

// Strategy 3: Sliding Window
// Pros: No context loss at boundaries
const slidingWindowStrategy = (
  document: string,
  windowSize: number = 512,
  overlap: number = 128,
): string[] => {
  const words = document.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += windowSize - overlap) {
    const chunk = words.slice(i, i + windowSize).join(" ");
    chunks.push(chunk);
  }

  return chunks;
};

// Strategy 4: Hierarchical (for legal docs)
// Pros: Preserves document structure
const hierarchicalChunkingStrategy = (document: LegalNode): Fragment[] => {
  const fragments: Fragment[] = [];

  const traverse = (node: LegalNode, path: string): void => {
    if (node.type === "article") {
      // Article is self-contained
      fragments.push({
        content: `${node.title || ""}\n${node.content}`,
        nodePath: path,
        nodeType: "article",
      });
    } else if (node.type === "paragraph") {
      // Paragraph may need context
      fragments.push({
        content: node.content,
        nodePath: path,
        nodeType: "paragraph",
      });
    }

    // Recurse
    if ("children" in node) {
      node.children.forEach((child, idx) => traverse(child, `${path}/${idx + 1}`));
    }
  };

  traverse(document, "/");
  return fragments;
};
```

---

## 5. Search Service Implementation

### 5.1 Hybrid Search (Vector + Full-Text)

```typescript
// services/search/service.ts
import { Effect, Option } from "effect";
import { EmbeddingService } from "~/services/embedding";

export interface SearchQuery {
  readonly query: string;
  readonly filters?: {
    docType?: string;
    dateFrom?: Date;
    dateTo?: Date;
    jurisdiction?: string;
  };
  readonly limit?: number;
}

export interface SearchResult {
  readonly fragmentId: string;
  readonly docId: string;
  readonly documentTitle: string;
  readonly content: string;
  readonly nodePath: string;
  readonly nodeType: string;
  readonly nodeTitle?: string;
  readonly relevanceScore: number;
  readonly precedingContext?: string;
  readonly followingContext?: string;
  readonly highlights: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export class SearchService extends Effect.Service<SearchService>()("SearchService", {
  dependencies: [EmbeddingService.Default, DatabaseService.Default],
  effect: Effect.gen(function* () {
    const embedding = yield* EmbeddingService;
    const db = yield* DatabaseService;

    // ───────────────────────────────────────
    // Vector Search
    // ───────────────────────────────────────

    const vectorSearch = Effect.fn("Search.vector")((query: SearchQuery) =>
      Effect.gen(function* () {
        // Embed query
        const queryEmb = yield* embedding.embed(query.query);
        const embedding = Array.isArray(queryEmb) ? queryEmb[0].full : queryEmb.full;

        // Build base query
        let dbQuery = db
          .select({
            fragment: senseFragments,
            similarity: sql<number>`
                  1 - (${senseFragments.embedding1024} <=> ${embedding}::vector)
                `,
          })
          .from(senseFragments)
          .innerJoin(legalDocuments, eq(senseFragments.docId, legalDocuments.docId))
          .orderBy(sql`${senseFragments.embedding1024} <=> ${embedding}::vector`)
          .limit(query.limit || 10);

        // Apply filters
        if (query.filters?.jurisdiction) {
          dbQuery = dbQuery.where(eq(legalDocuments.jurisdiction, query.filters.jurisdiction));
        }

        if (query.filters?.dateFrom) {
          dbQuery = dbQuery.where(gte(senseFragments.validFrom, query.filters.dateFrom));
        }

        const results = yield* dbQuery;

        return results.map((r) => ({
          fragmentId: r.fragment.fragmentId,
          docId: r.fragment.docId,
          documentTitle: r.fragment.nodeTitle || "Untitled",
          content: r.fragment.content,
          nodePath: r.fragment.nodePath,
          nodeType: r.fragment.nodeType,
          nodeTitle: r.fragment.nodeTitle,
          relevanceScore: r.similarity,
          precedingContext: r.fragment.precedingContext,
          followingContext: r.fragment.followingContext,
          highlights: findHighlights(r.fragment.content, query.query),
        }));
      }),
    );

    // ───────────────────────────────────────
    // Full-Text Search (PostgreSQL FTS)
    // ───────────────────────────────────────

    const textSearch = Effect.fn("Search.text")((query: SearchQuery) =>
      Effect.gen(function* () {
        const searchVector = sql`to_tsvector('spanish', ${senseFragments.content})`;
        const searchQuery = sql`plainto_tsquery('spanish', ${query.query})`;

        const results = yield* db
          .select({
            fragment: senseFragments,
            rank: sql<number>`ts_rank(${searchVector}, ${searchQuery})`,
            highlights: sql<string>`ts_headline(
                  'spanish',
                  ${senseFragments.content},
                  ${searchQuery},
                  'StartSel=<mark>, StopSel=</mark>'
                )`,
          })
          .from(senseFragments)
          .where(sql`${searchVector} @@ ${searchQuery}`)
          .orderBy(sql`ts_rank(${searchVector}, ${searchQuery}) DESC`)
          .limit(query.limit || 10);

        return results.map((r) => ({
          ...mapFragmentToResult(r.fragment),
          relevanceScore: r.rank,
          content: r.highlights, // Already marked with <mark> tags
        }));
      }),
    );

    // ───────────────────────────────────────
    // Hybrid Search (Reranking)
    // ───────────────────────────────────────

    const hybridSearch = Effect.fn("Search.hybrid")((query: SearchQuery) =>
      Effect.gen(function* () {
        // Get candidates from both methods
        const [vectorResults, textResults] = yield* Effect.all([
          vectorSearch(query),
          textSearch(query),
        ]);

        // Merge and deduplicate
        const merged = mergeResults(vectorResults, textResults);

        // Rerank using Jina reranker (optional, for precision)
        const reranked = yield* rerankResults(merged, query.query);

        return reranked;
      }),
    );

    // ───────────────────────────────────────
    // Find Similar Fragments
    // ───────────────────────────────────────

    const findSimilar = Effect.fn("Search.similar")((fragmentId: string) =>
      Effect.gen(function* () {
        // Get source fragment embedding
        const source = yield* db
          .select({ embedding: senseFragments.embedding1024 })
          .from(senseFragments)
          .where(eq(senseFragments.fragmentId, fragmentId))
          .limit(1);

        if (source.length === 0) {
          return yield* new SearchError({ message: "Fragment not found" });
        }

        // Find similar (excluding self)
        const similar = yield* db
          .select({
            fragment: senseFragments,
            similarity: sql<number>`
                  1 - (${senseFragments.embedding1024} <=> ${source[0].embedding}::vector)
                `,
          })
          .from(senseFragments)
          .where(
            and(
              sql`${senseFragments.fragmentId} != ${fragmentId}`,
              sql`1 - (${senseFragments.embedding1024} <=> ${source[0].embedding}::vector) > 0.85`,
            ),
          )
          .orderBy(sql`similarity DESC`)
          .limit(5);

        return similar;
      }),
    );

    return {
      vectorSearch,
      textSearch,
      hybridSearch,
      findSimilar,
    };
  }),
}) {}
```

### 5.2 Highlight Generation

```typescript
// utils/highlight.ts

// Find semantically relevant spans in text
const findHighlights = (
  text: string,
  query: string,
  embedding?: number[],
): Array<{ start: number; end: number; text: string }> => {
  // Simple keyword matching (fallback)
  const keywords = query.toLowerCase().split(/\s+/);
  const highlights: Array<{ start: number; end: number; text: string }> = [];

  const textLower = text.toLowerCase();

  for (const keyword of keywords) {
    let pos = textLower.indexOf(keyword);
    while (pos !== -1) {
      highlights.push({
        start: pos,
        end: pos + keyword.length,
        text: text.slice(pos, pos + keyword.length),
      });
      pos = textLower.indexOf(keyword, pos + 1);
    }
  }

  // Merge overlapping highlights
  return mergeOverlapping(highlights);
};

// More advanced: Use sentence embeddings to find most relevant sentences
const findSemanticHighlights = async (
  text: string,
  queryEmbedding: number[],
  embedding: EmbeddingService,
) => {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  const sentenceEmbeddings = await Effect.runPromise(jina.embed(sentences));

  // Score each sentence
  const scored = sentences.map((sent, idx) => ({
    text: sent,
    score: cosineSimilarity(
      Array.isArray(sentenceEmbeddings) ? sentenceEmbeddings[idx].full! : sentenceEmbeddings.full!,
      queryEmbedding,
    ),
  }));

  // Return top 3 sentences
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.text);
};
```

---

## 6. UI Integration Patterns

### 6.1 React Component with Highlighting

```typescript
// components/SearchResult.tsx
import { useState } from "react";
import { Result } from "@effect/atom";

interface SearchResultProps {
  result: SearchResult;
  query: string;
}

export const SearchResult: React.FC<SearchResultProps> = ({
  result,
  query,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Render with highlights
  const renderHighlightedContent = () => {
    let lastEnd = 0;
    const parts: React.ReactNode[] = [];

    for (const highlight of result.highlights) {
      // Text before highlight
      if (highlight.start > lastEnd) {
        parts.push(
          <span key={`text-${lastEnd}`}>
            {result.content.slice(lastEnd, highlight.start)}
          </span>
        );
      }

      // Highlighted text
      parts.push(
        <mark
          key={`highlight-${highlight.start}`}
          className="bg-yellow-200 rounded px-1"
        >
          {highlight.text}
        </mark>
      );

      lastEnd = highlight.end;
    }

    // Remaining text
    if (lastEnd < result.content.length) {
      parts.push(
        <span key={`text-end`}>
          {result.content.slice(lastEnd)}
        </span>
      );
    }

    return parts;
  };

  return (
    <article className="border rounded-lg p-4 mb-4">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-2">
        {result.documentTitle} / {result.nodeType} {result.nodeNumber}
      </nav>

      {/* Title */}
      <h3 className="text-lg font-semibold mb-2">
        {result.nodeTitle || "Untitled"}
      </h3>

      {/* Context (collapsible) */}
      {result.precedingContext && (
        <p className="text-gray-500 text-sm italic mb-2 line-clamp-2">
          ...{result.precedingContext.slice(-100)}
        </p>
      )}

      {/* Main content with highlights */}
      <div className="text-gray-800 leading-relaxed">
        {renderHighlightedContent()}
      </div>

      {/* Following context */}
      {result.followingContext && (
        <p className="text-gray-500 text-sm italic mt-2 line-clamp-2">
          {result.followingContext.slice(0, 100)}...
        </p>
      )}

      {/* Relevance score */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-400">
          Relevance: {(result.relevanceScore * 100).toFixed(1)}%
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:underline"
        >
          {expanded ? "Show less" : "Show full context"}
        </button>
      </div>

      {/* Full document view (expanded) */}
      {expanded && (
        <div className="mt-4 pt-4 border-t">
          <FullDocumentView
            docId={result.docId}
            highlightFragmentId={result.fragmentId}
          />
        </div>
      )}
    </article>
  );
};
```

### 6.2 Search State Management

```typescript
// state/search.ts
import { Atom } from "effect-atom/atom-react";
import { Effect, Data } from "effect";

// Errors
export class SearchError extends Data.TaggedError("SearchError")<{
  message: string;
  cause?: unknown;
}> {}

// Atoms
const searchQueryAtom = Atom.make("");
const searchResultsAtom = Atom.make<Result.Result<SearchResult[], SearchError>>(Result.initial());
const selectedFiltersAtom = Atom.make<SearchFilters>({});

// Computed
const hasResultsAtom = Atom.make((get) => Result.isSuccess(get(searchResultsAtom)));

// Actions
const performSearch = Effect.fn("search.perform")((query: string, filters: SearchFilters) =>
  Effect.gen(function* () {
    // Set loading
    Atom.set(searchResultsAtom, Result.loading());

    // Get search service
    const searchService = yield* SearchService;

    // Execute search
    const results = yield* searchService
      .hybridSearch({
        query,
        filters,
        limit: 20,
      })
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.tapError((e) => Effect.logError("Search failed", e)),
      );

    // Update state
    Atom.set(searchResultsAtom, Result.success(results));

    return results;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        Atom.set(
          searchResultsAtom,
          Result.failure(new SearchError({ message: String(error), cause: error })),
        );
        return [];
      }),
    ),
  ),
);
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1)

- [ ] Create `FragmentEmbeddingService` (Architecture A)
- [ ] Implement `LegalFragmentParser`
- [ ] Add fragment generation to existing BOE collector
- [ ] Database migrations (if needed)

### Phase 2: Embedding Pipeline (Week 2)

- [ ] Integrate Jina service with fragment batching
- [ ] Process existing documents through pipeline
- [ ] Verify HNSW index performance
- [ ] Add monitoring and error tracking

### Phase 3: Search API (Week 3)

- [ ] Implement `SearchService` with hybrid search
- [ ] Add vector search endpoint
- [ ] Add filters (date, jurisdiction, doc type)
- [ ] Performance testing

### Phase 4: UI Integration (Week 4)

- [ ] Search result component with highlighting
- [ ] Breadcrumb navigation
- [ ] "View in context" feature
- [ ] Similar fragments suggestion

### Phase 5: Advanced Features (Week 5-6)

- [ ] Semantic similarity between fragments
- [ ] Query suggestions
- [ ] Search analytics
- [ ] A/B testing framework

---

## 8. Performance Considerations

### 8.1 Embedding Generation

```typescript
// Batch size optimization
const OPTIMAL_BATCH_SIZE = 10; // Jina recommendation
const MAX_CONCURRENCY = 3; // Rate limit consideration

// With backpressure
const embeddingStream = Stream.fromIterable(fragments).pipe(
  Stream.grouped(OPTIMAL_BATCH_SIZE),
  Stream.mapEffect(processBatch, {
    concurrency: MAX_CONCURRENCY,
    unordered: false, // Preserve order
  }),
);
```

### 8.2 Search Performance

```sql
-- Vector search with prefiltering (faster than post-filtering)
SELECT * FROM sense_fragments
WHERE doc_id IN (
  SELECT doc_id FROM legal_documents
  WHERE jurisdiction = 'ES'
)
ORDER BY embedding_1024 <=> $1
LIMIT 10;

-- Materialized view for common queries
CREATE MATERIALIZED VIEW search_index AS
SELECT
  sf.*,
  ld.title as document_title,
  ld.jurisdiction,
  to_tsvector('spanish', sf.content) as search_vector
FROM sense_fragments sf
JOIN legal_documents ld ON sf.doc_id = ld.doc_id;
```

### 8.3 Caching Strategy

```typescript
// Embedding cache (expensive to compute)
const embeddingCache = Cache.make({
  capacity: 10000,
  timeToLive: Duration.days(30),
  lookup: (contentHash: string) => db.query.embeddingCache.findByHash(contentHash),
});

// Search result cache (frequently repeated queries)
const searchCache = Cache.make({
  capacity: 1000,
  timeToLive: Duration.minutes(5),
  lookup: (queryHash: string) => redis.get(`search:${queryHash}`),
});
```

---

## 9. Monitoring & Observability

```typescript
// Metrics
const metrics = {
  fragmentsIndexed: Metric.counter("fragments_indexed_total"),
  embeddingLatency: Metric.histogram("embedding_duration_ms"),
  searchLatency: Metric.histogram("search_duration_ms"),
  searchResults: Metric.counter("search_results_returned"),
};

// Logging
Effect.log("Fragment embedded", {
  fragmentId,
  docId,
  tokenCount,
  embeddingTime,
});

// Tracing
Effect.withSpan("FragmentEmbedding.embedFragments", {
  attributes: { docId, fragmentCount },
});
```

---

## 10. Conclusion

This architecture provides:

1. **Precise search results** - At the paragraph/section level, not document level
2. **Rich UI experience** - Highlighting, context, breadcrumbs
3. **Scalable processing** - Stream-based, backpressure-aware
4. **Flexible deployment** - Three architecture options for different scales
5. **Effect-idiomatic** - Using Layer, Service, Stream, Workflow patterns

The existing `sense_fragments` table is already perfectly designed for this. The main work is:

1. Creating the fragment parser
2. Integrating with Jina's late_chunking
3. Building the search service
4. Creating the UI components

Start with **Architecture A (Layered Service)** for simplicity, migrate to **Architecture B (Pipeline)** if you need to process millions of documents.
