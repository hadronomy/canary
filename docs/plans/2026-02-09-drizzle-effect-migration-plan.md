# Drizzle Effect Migration Plan (beta.15)

## Scope

- Complete migration to `drizzle-orm@1.0.0-beta.15` with first-class Effect usage (`drizzle-orm/effect-postgres`).
- Eliminate duplicate Drizzle type identities that currently break `tsc -b` in `apps/server/src/collectors/boe/bootstrap.ts`.
- Keep query surfaces effectful end-to-end and avoid `tryPromise` wrappers around Drizzle builders.

## Current State

- `packages/db/src/effect.ts` is already on `drizzle-orm/effect-postgres` and uses `PgDrizzle.make(...).pipe(Effect.provide(PgDrizzle.DefaultServices))`.
- Collector runtime now supports static factory-layer wiring via `CollectorLiveWithFactories(...)`.
- `apps/server` typecheck still fails with Drizzle private-field identity conflicts (`SQL` and column types from two package instances).

## Phase 1: Dependency Graph Stabilization

1. Ensure all workspaces consume a single `drizzle-orm` artifact.
2. Validate there are no path-mixed imports (`drizzle-orm` and compiled output copies) in server/db packages.
3. Reinstall cleanly (`bun install` from repo root) and confirm only one Drizzle identity is present in lock and compiler traces.
4. Re-run `bun run check-types` in `apps/server` and capture remaining errors.

Success criteria:

- No `private property 'cachedTables'` type identity errors.
- `SQL` and column types unify across `@canary/db` and `apps/server`.

## Phase 2: BOE Collector Query Surface Hardening

1. Audit `apps/server/src/collectors/boe/bootstrap.ts` for places still sensitive to mixed-type imports.
2. Keep all query execution directly effectful (`yield* db.select/insert/update...`) with typed `Effect.mapError` at boundaries.
3. Normalize expression builders (`eq`, `sql`, aliased selects) to the same Drizzle import source as table definitions.
4. Add targeted tests around bootstrap query paths if coverage is missing.

Success criteria:

- `bootstrap.ts` compiles without Drizzle overload mismatches.
- No regressions in BOE collector integration behavior.

## Phase 3: Effect-First DB Service Convergence

1. Keep DB access behind `DatabaseService.client()` returning Effect Drizzle client.
2. Remove legacy Promise wrappers around Drizzle builders in remaining modules.
3. Standardize error remapping to tagged domain errors at module boundaries.
4. Add a short migration guide in code comments where legacy styles remain temporary.

Success criteria:

- Database paths are Effect-native and preserve `R` requirements through service composition.
- No new `Effect.tryPromise` wrappers over Drizzle query builders.

## Execution Order

1. Phase 1 first (unblocks compiler).
2. Phase 2 second (BOE compile + correctness).
3. Phase 3 third (cleanup and consistency).

## Verification Checklist

- `bun test src/services/collector/api.test.ts src/services/collector/orchestrator.test.ts` (apps/server)
- `bun run check-types` (apps/server)
- `bun run build` (apps/server)
- `lsp_diagnostics` clean for all modified files
