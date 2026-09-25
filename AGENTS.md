# Canary agent guide

Canary is a Rust and TypeScript monorepo for legal document retrieval. Use the code and package scripts in the affected area as the source of truth.

## Before editing

- State the observable result for a multi-step task. Resolve material uncertainty before choosing a design.
- Read nearby code and tests before choosing a pattern. Read the affected package's manifest before choosing a command or dependency.
- Keep edits tied to the task. Remove unused code created by your edits, and leave unrelated code alone.
- Run `just --list` for repository workflows. Use a focused test or check for the changed area before a full workspace check.
- Read `docs/namespace-imports-and-exports.md` before changing TypeScript import or export conventions. Canary uses namespace imports in places where OpenCode uses self-exports.

## Project boundaries

- `crates/` contains the Rust parser, server, workers, and supporting crates. Use the root `justfile` for Rust checks.
- `crates/database/src/` owns the SurrealDB runtime connection. Keep Surrealkit schema, rollouts, seeds, and database tests in `crates/database/database/`. Read `docs/database-workflow.md` before changing that schema.
- `packages/db/` owns the separate Postgres and Drizzle schema for the TypeScript app. Use its `db:*` and `replica:*` scripts for that schema and its generated replica files.
- For environment changes, edit the owning `.env.schema` and use the applicable Varlock codegen script. Generated `src/env.ts` files are ignored.
- `apps/web/` contains the web app; `apps/tui/` contains the OpenTUI app. Check each app's dependencies before sharing code or guidance between them.

## TypeScript and Effect

- Use `bun` for workspace dependencies and scripts. Add dependencies with `bun add` from the owning workspace; commit the resulting `bun.lock`. Use `bunx --no-install` for pinned package executables.
- Use the `~/*` alias for imports within an app or package when its `tsconfig.json` defines that alias. Use workspace package names across package boundaries.
- Keep names short when they stay clear. Prefer inference and `const`; avoid `any` and single-use helpers that hide simple code.
- Validate unknown data once at the boundary that owns it. Pass typed values inward without repeating the same checks.
- For Effect code, inspect the installed version, its types, and nearby usage before editing. Most TypeScript packages use Effect 4; `apps/tui/` uses Effect 3. Do not apply a v4 API to the TUI.
- For Effect 4 concepts, consult the upstream [Effect v4 guide](https://github.com/Effect-TS/effect/blob/main/LLMS.md), then confirm APIs against this repo's installed version. Use `@effect/vitest` and `it.effect` for Effect tests where that package uses them.

## Verification

- Run tests that cover changed behavior. Follow the affected package's test script or the nearest existing test; test runners differ across packages.
- Run the affected type check and lint or format checks. Use `just check` for changes that cross Rust and TypeScript boundaries.
- Report each check you ran and any check that remains blocked. Keep generated files in sync through their owning scripts.
