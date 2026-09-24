# Surrealkit 0.6.3 → 0.7.0 Changes

Upgrade notes for the 0.6.3 to 0.7.0 bump (`cargo:surrealkit` in `mise.toml`).
Canonical source is the [surrealdb/surrealkit](https://github.com/surrealdb/surrealkit)
repo. There is no changelog file in that repo, so every claim below links to
the [v0.7.0 release](https://github.com/surrealdb/surrealkit/releases/tag/v0.7.0)
(2026-06-11), its PRs, or the tagged source. v0.7.0 is the only release in
range: v0.6.3 shipped 2026-05-13 and the full range is
[v0.6.3...v0.7.0](https://github.com/surrealdb/surrealkit/compare/v0.6.3...v0.7.0)
(19 commits). Installed binary confirms `surrealkit 0.7.0` with the new
commands below.

## Breaking changes

- **Rust library API only; the CLI is behavior-compatible.** The release
  reworks the programmatic surface instead of papering over it (the crate is
  pre-1.0). This project uses Surrealkit as a CLI through `just db-*`, so it
  is not affected.
  ([PR #61](https://github.com/surrealdb/surrealkit/pull/61))
- Library renames, before/after in the PR body: `RolloutStep`'s bag of
  optional `sql`/`files`/`expect`/`entities`/`idempotent` fields becomes a
  tagged `RolloutAction` enum (`ApplySchema`/`ApplyFiles`/`RunSql`/
  `AssertSql`/`RemoveEntities`); `compatibility: String` becomes a
  `RolloutCompatibility` enum; `EntityKey.kind`/`CatalogEntity.kind` become an
  `EntityKind` enum (unknown values survive as `Other(String)`); the
  `idempotent` flag is removed; `lib.rs` re-exports only the happy path; the
  redundant `folder` param is collapsed into `SyncOpts.folder`. New entry
  points are `Sync::embedded(SCHEMA)...run(&db)` and
  `RolloutSpec::builder(id)` plus `Rollout::new(spec, target)`.
  ([PR #61](https://github.com/surrealdb/surrealkit/pull/61))

## New CLI commands and flags

- `surrealkit typegen` introspects the live database and writes a typed JSON
  schema document, default `{folder}/types/schema.json`. Flags: `--out`,
  `--stdout`, `--compact` (single-line JSON, pretty-printed by default).
  ([PR #59](https://github.com/surrealdb/surrealkit/pull/59),
  [main.rs at v0.7.0](https://github.com/surrealdb/surrealkit/blob/v0.7.0/crates/surrealkit/src/main.rs))
- TypeScript output for `typegen`, driven by a new `[typegen]` section in
  `surrealkit.toml`: `typescript = "<dir>"` enables generation of `<dir>/
index.ts` (tables become `interface`s with `id: RecordId<'table'>` per the
  SurrealDB JS SDK v2 record model); `format = "<cmd>"` runs a
  formatter/linter on the generated file with the path appended as the final
  arg (missing binary or non-zero exit only warns, never fails). `sync` and
  `sync --watch` auto-regenerate the file after each applied schema change,
  gated on actual changes or a missing output file.
  ([PR #62](https://github.com/surrealdb/surrealkit/pull/62),
  [typegen/mod.rs at v0.7.0](https://github.com/surrealdb/surrealkit/blob/v0.7.0/crates/surrealkit/src/typegen/mod.rs),
  [sync.rs at v0.7.0](https://github.com/surrealdb/surrealkit/blob/v0.7.0/crates/surrealkit/src/sync.rs))
- `surrealkit rollout repair <id>` heals a rollout stuck in an intermediate
  state without re-running any step SQL: `running_complete` flips to
  `completed` (restores `target_entities`), `running_rollback` flips to
  `rolled_back` (restores `source_entities`), `running_start` flips to
  `failed` with a note to re-run `start` or `rollback`. Already-terminal
  rollouts are a no-op.
  ([PR #56](https://github.com/surrealdb/surrealkit/pull/56))
- `sync --allow-all-statements` permits non-`DEFINE` statements (for example
  `UPSERT` for static rows) in schema files. Such operations run after all
  entities apply. Trade-off, from the flag help: it disables catalog entity
  tracking and only file-level hashes are tracked.
  ([PR #47](https://github.com/surrealdb/surrealkit/pull/47),
  [main.rs at v0.7.0](https://github.com/surrealdb/surrealkit/blob/v0.7.0/crates/surrealkit/src/main.rs))
- `init` now scaffolds from a template instead of emitting a fixed empty
  project (bare `Init` variant in
  [v0.6.3](https://github.com/surrealdb/surrealkit/blob/v0.6.3/crates/surrealkit/src/main.rs)).
  New flags: `--template` (default `default`), `--from <git-url|local-path>`
  with `#rev` / `#rev:subdir` support, repeatable `--feature <id>`,
  `--minimal`, `-y`/`--yes`, `--force`. Templates embed into the binary at
  build time. The bundled `default` template carries an opt-in org/auth
  model: base `organizations` feature plus `teams`, `units`, and
  `subsidiaries` (each requires `organizations`).
  ([PR #65](https://github.com/surrealdb/surrealkit/pull/65))
- Global `--folder` flag plus `SURREALDB_FOLDER` env var configure the store
  folder (still defaults to `./database`). This also fixes the path used
  inside the Docker container.
  ([PR #48](https://github.com/surrealdb/surrealkit/pull/48),
  [config.rs at v0.7.0](https://github.com/surrealdb/surrealkit/blob/v0.7.0/crates/surrealkit/src/config.rs))

## Behavior changes and bug fixes

- **Rollout hang fixed** ([issue #55](https://github.com/surrealdb/surrealkit/issues/55)):
  `rollout complete` could hang after applying all steps (seen against
  SurrealDB Cloud), leaving `__rollout.status` at `running_complete`. Two
  fixes: catalog writes go through one bound query (`FOR $e IN $entities`
  upsert, `key INSIDE $keys` delete) instead of one HTTP round-trip per
  entity, and the CLI flushes stdio then calls `std::process::exit(0)` so
  HTTP pool tasks cannot keep the process alive after success.
  ([PR #56](https://github.com/surrealdb/surrealkit/pull/56))
- **Prune drift self-heals**: the sync pruner now emits `REMOVE ... IF
EXISTS` for every entity kind, so a catalog row whose live entity was
  dropped out-of-band (for example by a `run_sql REMOVE ...` rollout step)
  no longer halts the whole prune batch with `<entity> does not exist`.
  ([PR #51](https://github.com/surrealdb/surrealkit/pull/51))
- **Test fixtures get template variables**: `apply_fixture` now runs
  `TemplateVars::apply` over fixture SQL, matching the seed/rollout/schema
  flows. `${VAR}` tokens in fixtures (inline or file) previously reached
  SurrealDB verbatim and failed.
  ([PR #50](https://github.com/surrealdb/surrealkit/pull/50))
- **`DEFINE MODULE` is now schema state** ([issue #53](https://github.com/surrealdb/surrealkit/issues/53)):
  modules parse into the catalog, prune as `REMOVE MODULE IF EXISTS <name>`,
  and get `OVERWRITE` injected on sync like other `DEFINE` kinds.
  ([PR #60](https://github.com/surrealdb/surrealkit/pull/60))
- **Embedded sync no longer writes files**: it initializes metadata tables in
  the DB only and no longer scribbles `database/setup.surql` into the
  caller's working directory. The `embed_schema!` macro emitted a call that
  did not match the library signature; it now emits
  `Sync::embedded(SCHEMA).run(db)`.
  ([PR #61](https://github.com/surrealdb/surrealkit/pull/61))
- **Dependency bumps**: SurrealDB crate 3.1.3 → 3.1.4
  ([PR #67](https://github.com/surrealdb/surrealkit/pull/67));
  `rand` 0.8.5 → 0.8.6, `rustls-webpki` 0.103.6 → 0.103.13, `quinn-proto`
  0.11.13 → 0.11.14, `time` 0.3.43 → 0.3.47
  ([release notes](https://github.com/surrealdb/surrealkit/releases/tag/v0.7.0)).
- Release-process fixes only (no behavior): Dockerfile template copy and
  bundling `templates/` inside the published crate
  ([PR #68](https://github.com/surrealdb/surrealkit/pull/68),
  [PR #69](https://github.com/surrealdb/surrealkit/pull/69)); README template
  var example and license badge
  ([PR #64](https://github.com/surrealdb/surrealkit/pull/64));
  version bumps for the 0.7.0 release
  ([PR #66](https://github.com/surrealdb/surrealkit/pull/66)).

## Project impact

No edits needed to `justfile` `db-*` tasks, `crates/database/surrealkit.toml`,
`docs/database-workflow.md`, or anything under `crates/database/database/`.
Reasons:

- The project drives Surrealkit through the CLI (`sync`, `seed`, `test`,
  `status`, `rollout ...`), and the release is CLI behavior-compatible.
- Existing commands keep their flags; `--watch`, `--dry-run`, `--var`, and
  the rollout verbs are unchanged (verified against
  [v0.6.3 main.rs](https://github.com/surrealdb/surrealkit/blob/v0.6.3/crates/surrealkit/src/main.rs)
  and the installed 0.7.0 `--help` output).
- The default `./database` folder matches this repo's layout, so `--folder`
  / `SURREALDB_FOLDER` need no adoption.
- `typegen` and `--allow-all-statements` are opt-in. Note the trade-off if
  the latter ever looks tempting for static rows: it drops catalog entity
  tracking to file-level hashes.

Worth knowing, no action required:

- If a rollout ever sticks mid-flight, `surrealkit rollout repair <id>`
  replaces the manual `UPDATE __rollout ... SET status = ...` workaround.
- `DEFINE MODULE` statements in `schema/` now sync and prune correctly.
- Test fixtures now honor `--var` substitutions, so shared `${VAR}` tokens
  work in `tests/` fixtures.
- Optional follow-up: add a `[typegen]` section to
  `crates/database/surrealkit.toml` to get generated TypeScript types on
  `typegen` / `sync --watch` runs.
