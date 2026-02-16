# BOE XML Parser Implementation Spec (PR-Ready)

## 1) Goal

Implement a production-ready BOE XML parser that produces deterministic, searchable fragments for `sense_fragments`, while handling BOE document-type variation (`rango_codigo`, `seccion`) and known structural anomalies.

This spec is implementation-oriented and meant to be executed as one focused PR (or a small PR stack).

---

## 2) Scope

### In scope

- Parse BOE XML into typed document model + normalized fragments.
- Strategy selection by metadata (`legislative | simple | announcement | generic`).
- Stable `nodePath` generation and fragment ordering.
- Table extraction and marker normalization (`[encabezado]`, `[precepto]`).
- Typed parser errors and traceable Effect entrypoints.
- Fixture-driven tests for known BOE patterns and edge cases.

### Out of scope

- Embedding generation changes (Jina pipeline remains downstream).
- Search ranking/reranking changes.
- UI rendering changes.

---

## 3) Source Constraints and Design Rules

Derived from:

- `docs/boe-xml-parser-architecture.md`
- `docs/boe-xml-inconsistencies-study.md`
- `docs/node-extraction-guide.md`
- `docs/fragment-based-search-architecture.md`
- `docs/effect-primitives/*.md`

### Hard rules

1. `nodePath` must be deterministic and unique per document.
2. `nodePath` is positional, not legal-label-based.
3. `nodeNumber` / `nodeTitle` carry legal labels (`1.º`, `Primera`, etc.).
4. Unknown classes must not break traversal (fallback to `raw` block handling).
5. Tables are first-class content blocks and cannot be silently dropped.
6. Parse failures must return typed tagged errors (no uncaught throws).

---

## 4) Proposed Architecture

## 4.1 Public Service Contract

Create a parser service with two public operations:

- `parseDocument(xml: string): Effect<BoeXmlDocument, BoeParseError>`
- `parseToFragments(xml: string): Effect<ReadonlyArray<BoeFragment>, BoeParseError>`

Both should be named with `Effect.fn(...)` for tracing.

## 4.2 Internal Pipeline

1. **Raw parse**: XML -> raw JS object with parser options preserving attributes and text.
2. **Boundary validation**: ensure root `<documento>` and required metadata shape.
3. **Strategy selection**: derive parsing strategy from metadata (`rango_codigo`, `seccion`, optional subseccion).
4. **Block linearization**: normalize `<texto>` into an ordered list of `p` and `table` blocks.
5. **Block classification/normalization**: map class markers and normalize content (article/chapter/subparagraph markers).
6. **Fragment build**: state-machine traversal that emits deterministic paths and context fields.
7. **Post-conditions**: invariants check (uniqueness, monotonic sequence, non-empty content where required).

---

## 5) Data Model (Implementation Targets)

## 5.1 Core Domain Types

Add/update parser domain types:

- `BoeXmlDocument`
- `BoeMetadata`
- `BoeAnalysis`
- `LegalReference`
- `BoeTextNode` discriminated union
- `BoeFragment`

## 5.2 Internal Types

Add internal parsing types for clarity:

- `ParsingStrategy = "legislative" | "simple" | "announcement" | "generic"`
- `LinearBlock = ParagraphBlock | TableBlock`
- `ParserState` (chapter/article/annex counters + current headers)
- `NormalizedArticleHeader`, `NormalizedChapterHeader`, `NormalizedSubparagraph`

---

## 6) Error Taxonomy

Define typed errors (`Schema.TaggedError` preferred):

- `MissingRootDocumentoError`
- `InvalidMetadataError`
- `UnsupportedStrategyError`
- `MalformedTextSectionError`
- `NodePathCollisionError`
- `EmptyFragmentContentError` (for required node kinds)
- `XmlParseError` (wrap parser-level exceptions)

All parser entrypoints return `Effect` with this error union.

---

## 7) Node Path and Ordering Specification

## 7.1 Path format

- Root preamble paragraphs: `/p/<n>`
- Legislative body paragraph: `/c/<chapterIndex>/a/<articleIndex>/p/<paragraphIndex>`
- Annex paragraph: `/x/<annexIndex>/p/<paragraphIndex>`
- Table in body: `/c/<chapterIndex>/a/<articleIndex>/t/<tableIndex>`
- Table in annex: `/x/<annexIndex>/t/<tableIndex>`

Use numeric counters only in path segments.

## 7.2 Ordering

- `sequenceIndex` is emission order in document traversal.
- Traversal order follows source XML order after linearization.
- Repeated runs over same XML produce identical `(nodePath, sequenceIndex)` pairs.

---

## 8) Normalization Rules

Implement as isolated pure helpers:

1. `normalizeChapterHeader(text)`
   - Strip `[encabezado]`
   - Detect special sections (`DISPOSICIONES ADICIONALES`, `DISPOSICIÓN DEROGATORIA`, etc.)

2. `normalizeArticleHeader(text)`
   - Handle `Artículo 1.º`, `Art. 2.º`, `Artículo 5.º Objeto.`, `[precepto]Primera.`

3. `normalizeSubparagraph(text)`
   - Handle marker variants: `a)`, `a.`, `1.`

4. `normalizeTable(tableNode)`
   - Extract headers + body rows into stable text representation

5. `normalizeTextContent(text)`
   - Trim/space normalization without deleting legal punctuation or list markers

---

## 9) File-by-File Change Plan

Use exact paths as checklist while implementing.

### A. Parser domain and errors

- `src/services/boe-parser/types.ts`
  - Add public parser types (`BoeXmlDocument`, `BoeFragment`, etc.).
- `src/services/boe-parser/errors.ts`
  - Add typed tagged error classes.

### B. Parser service

- `src/services/boe-parser/service.ts`
  - Implement `BoeXmlParser` `Effect.Service`.
  - Implement `parseDocument` and `parseToFragments` with `Effect.fn` names.
  - Keep execution at boundaries only; no `Effect.runPromise` internally.

### C. Internal parser modules

- `src/services/boe-parser/strategy.ts`
  - `determineParsingStrategy(metadata)`.
- `src/services/boe-parser/linearize.ts`
  - XML `<texto>` to ordered `LinearBlock[]`.
- `src/services/boe-parser/normalize.ts`
  - chapter/article/subparagraph/table normalization helpers.
- `src/services/boe-parser/fragments.ts`
  - state-machine fragment builder + path emission + context extraction.
- `src/services/boe-parser/invariants.ts`
  - uniqueness/order/content invariant checks.

### D. Tests and fixtures

- `test/fixtures/boe/legislative-full.xml`
- `test/fixtures/boe/simple-administrative.xml`
- `test/fixtures/boe/announcement-oposiciones.xml`
- `test/fixtures/boe/with-tables.xml`
- `test/fixtures/boe/legacy-markers.xml`
- `test/services/boe-parser/parse-document.test.ts`
- `test/services/boe-parser/parse-fragments.test.ts`
- `test/services/boe-parser/normalization.test.ts`
- `test/services/boe-parser/invariants.test.ts`

### E. Collector integration (minimal)

- `src/collectors/boe/factory.ts`
  - Replace ad-hoc parsing path with `BoeXmlParser.parseToFragments`.
  - Preserve existing downstream mapping to `sense_fragments` fields.

---

## 10) Test Matrix (Must Pass)

## 10.1 Fixture matrix

| Fixture                        | Strategy              | Must verify                                                           |
| ------------------------------ | --------------------- | --------------------------------------------------------------------- |
| `legislative-full.xml`         | `legislative`         | chapter/article flow, `[encabezado]`, `[precepto]`, annex transitions |
| `simple-administrative.xml`    | `simple`              | mostly `parrafo`/`parrafo_2`, no false chapter/article assumptions    |
| `announcement-oposiciones.xml` | `announcement`        | `parrafo_2` heavy content, signature lines, stable ordering           |
| `with-tables.xml`              | `simple` or `generic` | table extraction, table node paths, no dropped rows                   |
| `legacy-markers.xml`           | `generic`             | unknown classes fallback + no path collisions                         |

## 10.2 Invariant tests

For every fixture:

- no duplicate `nodePath`
- monotonic `sequenceIndex`
- deterministic output across repeated runs
- no empty content for fragment types requiring content
- parser returns typed tagged errors for malformed input

---

## 11) PR Breakdown (Recommended)

## PR 1: Parser core

- Types + errors + service skeleton + raw parse + strategy selection.
- Green tests: metadata extraction + malformed XML errors.

## PR 2: Fragment builder and normalization

- Linearizer + normalizers + state-machine path builder + invariants.
- Green tests: fixture matrix + nodePath determinism.

## PR 3: Collector integration

- Wire parser into BOE collector path.
- Green tests: integration smoke test and fragment persistence shape.

If a single PR is preferred, preserve this commit structure internally.

---

## 12) Acceptance Criteria

Implementation is complete when all are true:

1. `parseDocument` and `parseToFragments` return typed `Effect` results.
2. Strategy selection is metadata-driven and covered by tests.
3. Tables and marker variants are parsed and normalized.
4. `nodePath` uniqueness + determinism invariants pass on all fixtures.
5. Collector integration consumes parser output without schema drift.
6. No `as any`, no suppression comments, no boundary execution leaks.

---

## 13) Rollout and Safety

- Add a dry-run mode for corpus validation before write-path rollout.
- Log parser strategy choice and error tags per document.
- Compare fragment counts/paths against current parser path for a sample corpus.
- Enable write path after acceptance thresholds are met.

Suggested readiness thresholds:

- > = 99% successful parses on validation corpus
- 0 `nodePath` collisions
- 0 untyped/unclassified parser failures

---

## 14) Open Decisions (Resolve Before Coding)

1. Whether table fragments use dedicated `nodeType` values or map to existing enum values.
2. Whether special sections (`disposición final`, `transitoria`, `derogatoria`) map to dedicated node types now or in a follow-up.
3. Corpus size for dry-run validation gate.

---

## 15) Execution Checklist

- [ ] Create parser modules and typed errors.
- [ ] Implement strategy selector and linearizer.
- [ ] Implement normalizers and path state machine.
- [ ] Add fixtures and invariant-driven tests.
- [ ] Integrate into collector factory.
- [ ] Run parser corpus dry-run and publish metrics.
- [ ] Enable write path after thresholds.
