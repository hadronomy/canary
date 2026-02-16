# BOE Parser Path API vs PostgreSQL `ltree`

## Summary

The current BOE fragment/node path API is compatible with the existing PostgreSQL `btree` setup, but it is **not natively compatible with `ltree`** without schema and path-format changes.

## What Exists Today

- Fragment paths are generated as slash-based strings, e.g. `/c/22/a/3/sp/1`.
  - Source: `apps/server/src/collectors/boe/parser/traversal/path-allocator.ts`
- Fragment path values are stored as `varchar(500)` in `sense_fragments.node_path`.
  - Source: `packages/db/src/schema/legislation.ts`
- A unique `btree` index exists on `(doc_id, node_path)`.
  - Source: `packages/db/src/schema/legislation.ts`
  - Source: `packages/db/src/migrations/20260209042532_little_spectrum/migration.sql`
- No `ltree` extension usage, no `ltree` columns, and no `GiST`/`GIN` `ltree` indexes exist in current schema/migrations.
  - Source search in `packages/db`: no matches for `ltree`, `lquery`, `ltxtquery`, `@>`, `<@` for `ltree` semantics.

## Why It Is Not `ltree`-Compatible As-Is

1. Separator mismatch:
   - Current paths use `/` segments.
   - `ltree` uses `.`-separated labels.

2. Segment model mismatch:
   - Current path alternates type/index segments (`c/22/a/3/sp/1`).
   - `ltree` expects one label per segment.

3. Legal path normalization requirement:
   - Some legal path segments include hyphens (for example, `disposicion-adicional`).
   - These should be normalized consistently before storing as `ltree` labels.

## Practical Compatibility Verdict

- **Current state:** good for exact and prefix-style path lookups with `btree` on `(doc_id, node_path)`.
- **For native hierarchical operators (`@>`, `<@`) and tree queries:** add dedicated `ltree` columns and indexes.

## Recommended Migration Plan (If `ltree` Is Desired)

1. Add `ltree` columns:
   - `sense_fragments.node_path_ltree ltree`
   - Optional: `sense_fragments.legal_node_path_ltree ltree`

2. Backfill with deterministic transform:
   - Example mapping: `/c/22/a/3/sp/1` -> `c_22.a_3.sp_1`
   - Keep mapping logic centralized and tested.

3. Add `GiST` index(es) for hierarchical queries:
   - `CREATE INDEX ... USING gist (node_path_ltree)`
   - Optional second index for legal path ltree column.

4. Keep current `varchar` path + unique `(doc_id, node_path)` index:
   - Preserves backward compatibility with current API behavior and existing queries.

## Notes

- `token_count` in `sense_fragments` is currently maintained by DB triggers with a heuristic (`word_count * 1.3`) in:
  - `packages/db/src/migrations/20260209043000_triggers/migration.sql`
- This is orthogonal to `ltree`, but relevant if path migration and fragment reindexing are done together.
