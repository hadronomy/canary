# Replica versioning research

Research date: 2026-09-18

Scope: the private `make` function in `packages/sync`, the generated replica
numbers in `packages/db`, and the boundary between TanStack DB cache resets,
Electric shape state, and Drizzle database migrations.

## Decision summary

Keep a per-replica numeric cache version for
`persistedCollectionOptions({ schemaVersion })`. Keep the full content digest
and Drizzle migration provenance beside it in the generated manifest.

Do not use the cache version as a database migration number. Drizzle Kit owns
database migration identity and application. The browser only uses the cache
version to decide if it must discard local rows and sync them again.

## Where `make` and `cacheVersion` are used

`make` is a private constructor in
[`packages/sync/src/index.ts`](../../packages/sync/src/index.ts). The five
model-specific constructors call it:

- `makeThreads` calls `make(Replica.Thread, ...)`.
- `makeMessages` calls `make(Replica.Message, ...)`.
- `makeRuns` calls `make(Replica.Run, ...)`.
- `makeEvents` calls `make(Replica.Event, ...)`.
- `makeParts` calls `make(Replica.Part, ...)`.

The exported `threads`, `messages`, `runs`, `events`, and `parts` functions call
those constructors after they check their scope cache. Application code calls
only those exported functions. It does not call `make`.

Inside `make`, `replica.cacheVersion` is passed to TanStack DB as
`persistedCollectionOptions({ schemaVersion: replica.cacheVersion })`. The value is
attached to each descriptor in
[`packages/db/src/replica/index.ts`](../../packages/db/src/replica/index.ts)
from the generated
[`manifest.generated.ts`](../../packages/db/src/replica/manifest.generated.ts).

Before this change, the generator in
[`packages/db/scripts/replica.ts`](../../packages/db/scripts/replica.ts)
did the following:

1. Selects the lexicographically last `*/snapshot.json` file.
2. Selects the named columns for each replica from that snapshot.
3. Hashes column names, the replica name, the table name, the Zod JSON Schema,
   and the `where` clause.
4. Sorts object keys, computes SHA-256, and parses the first 13 hexadecimal
   characters as a safe JavaScript integer.
5. Wrote only those numeric values to the generated file.

The number was a deterministic content fingerprint. It was not a
counter, a migration ordinal, a timestamp, or a value read from PostgreSQL.

## What the sources establish

### TanStack DB persistence

TanStack DB defines `schemaVersion` as a number on the persisted collection
options. The SQLite adapter compares the stored number with the current
number. A mismatch uses a schema mismatch policy. The browser persistence
wrapper defaults a synced collection to `sync-present-reset`.

The reset removes collection rows, tombstones, applied transaction records, and
persisted indexes. The synced collection then obtains the rows from its sync
source again. The adapter has no general row migration callback. This makes the
number a cache reset key, not a migration plan.

Sources:

- [TanStack SQLite adapter source](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts)
- [TanStack persisted collection source](https://github.com/TanStack/db/blob/main/packages/db-sqlite-persistence-core/src/persisted.ts)
- [TanStack browser persistence source](https://github.com/TanStack/db/blob/main/packages/browser-db-sqlite-persistence/src/browser-persistence.ts)
- [TanStack DB schemas guide](https://tanstack.com/db/latest/docs/guides/schemas)

The schemas guide also states that a collection schema validates client
mutations. It does not automatically validate rows from a server or sync
layer. Canary's Electric `transformer` must therefore remain part of the
replica contract. A change to that transform can require a cache reset even if
the Zod JSON Schema text does not change.

The SQLite adapter serializes dates as ISO strings, booleans as integers,
bigints as strings, and other values as JSON. A future change to this encoding
is also a cache contract change.

### Electric shape state

Electric identifies a shape through its URL and PostgreSQL parameters. Those
parameters include the table, `where`, positional parameters, selected
columns, and replica mode. The client separately stores a shape handle and an
offset to resume the shape log. A handle is server sync state. It is not the
same thing as the local SQLite schema version.

Sources:

- [TanStack Electric collection source](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts)
- [Electric TypeScript client API](https://electric-sql.com/docs/api/clients/typescript)
- [Electric ShapeStream source](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/shape.ts)
- [Electric ShapeStream state specification](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/SPEC.md)

The cache contract must include the effective shape inputs and the mapping and
transform policies that turn Electric rows into collection rows. It must not
use an Electric handle as a schema version. Electric can rotate a handle when
a shape expires.

### Drizzle Kit v1

Drizzle v1 stores DDL snapshots in migration folders. Each snapshot has an
`id` and `prevIds`. Drizzle Kit builds a DAG from `prevIds` for commutativity
checks. Therefore, selecting a snapshot by folder sort order is not a safe
definition of the current migration head when branches exist.

Drizzle v1 reads migration folders in name order and calculates a SHA-256 hash
of each `migration.sql` file. The installed RC records the folder name, SQL
hash, and folder timestamp in `__drizzle_migrations`. It currently selects
pending migrations by folder name. This database table is the migration record
that future deployment code must use.

Drizzle Kit RC 4 also has a public `drizzle-kit/cli` SDK. Its `generate()`
result returns the exact `migration_path`, and its `check()` result reports
migration-history errors. A generator can use these typed results instead of
parsing terminal output or guessing the newest path.

Sources:

- [Drizzle v0 to v1 changes](https://orm.drizzle.team/docs/v0-v1-changes)
- [Drizzle v1 upgrade](https://orm.drizzle.team/docs/upgrade-v1)
- [Drizzle Kit overview](https://orm.drizzle.team/docs/kit-overview)
- [Drizzle Kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- [Drizzle Kit push](https://orm.drizzle.team/docs/drizzle-kit-push)
- [Drizzle ORM v1 RC 4 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4)
- [Drizzle Kit source](https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-kit)

## Recommended generated data model

Generate one top-level migration record and one contract record per replica.
Keep the numeric field because TanStack's interface requires a number. Add the
full digests and provenance for diagnostics and future tooling:

```ts
type ReplicaManifest = {
  readonly format: 2
  readonly database: {
    readonly dialect: 'postgres'
    readonly historyDigest: string
    readonly history: ReadonlyArray<{
      readonly migration: string
      readonly timestamp: number
      readonly sqlDigest: string
      readonly snapshotDigest: string
      readonly snapshotId: string
      readonly prevIds: ReadonlyArray<string>
    }>
    readonly head: {
      readonly migration: string
      readonly timestamp: number
      readonly sqlDigest: string
      readonly snapshotDigest: string
      readonly snapshotId: string
      readonly prevIds: ReadonlyArray<string>
    }
  }
  readonly replicas: Record<string, {
    readonly cacheVersion: number
    readonly digest: string
    readonly algorithm: 'sha256-canonical-json-v2'
    readonly contract: {
      readonly name: string
      readonly table: string
      readonly schema: string
      readonly columns: ReadonlyArray<{
        readonly name: string
        readonly type: string
        readonly typeSchema: string | null
        readonly notNull: boolean
        readonly dimensions: number
      }>
      readonly rowSchema: unknown
      readonly where: string
      readonly mapper: 'electric-snake-camel-v1'
      readonly transformer: 'drizzle-zod-date-v1'
      readonly persistence: 'tanstack-sqlite-json-v1'
    }
  }>
}
```

The exact TypeScript shape can stay private to the generated module. Export a
small public accessor if runtime diagnostics need it. Do not include a
database URL, credentials, or row data.

The `cacheVersion` value must be derived only from the cache contract. Keep database
migration provenance outside that hash. An unrelated Better Auth migration
must not reset the `threads` cache when the `threads` shape is unchanged.

## Recommended algorithm

### 1. Resolve the Drizzle snapshot head from the graph

Read all v3 snapshots. Build an index by snapshot `id`, then find snapshot IDs
that no later snapshot lists in `prevIds`. Require one head. Fail with the
branch names when the repository has multiple heads. Do not select one branch
with configuration because a deployment must account for every branch.

This follows Drizzle's `prevIds` DAG model. It removes the current dependence
on lexicographic folder order.

### 2. Read physical column metadata

For each selected replica column, preserve the complete DDL column entry from
the head snapshot. Store its full digest for diagnostics. Include only fields
that affect the Electric row representation in the cache digest, such as the
physical type, type schema, dimensions, and nullability. A default or index
change does not need to clear a compatible client cache.

The current Effect decoder keeps only `entityType`, `name`, and `table`. It
removes the other DDL fields before the hash runs.

Keep the current column-set equality check. It catches a replica that names a
column absent from the Drizzle snapshot.

### 3. Hash the complete local contract

Use canonical JSON with sorted object keys and a fixed, named algorithm. Include
these inputs:

- replica name and physical table/schema;
- selected physical columns and their DDL metadata;
- row schema and its input/output transform contract;
- Electric table, `where`, parameters, selected columns, and replica mode;
- column mapper and transformer revision;
- persisted value encoding revision;
- collection key and any persistence index contract that requires a reset.

Compute a full SHA-256 hexadecimal digest. Derive `cacheVersion` from the first 13
hexadecimal characters to preserve the current safe-integer interface. Store
the full digest so operators can identify the exact contract and so a future
manifest format can stop using a truncated number.

Do not hash the entire database snapshot for every replica. Filter the DDL to
the replica's physical projection. This keeps an auth-only migration from
invalidating unrelated sync collections.

### 4. Record migration provenance separately

For the selected head, record the migration folder name, folder timestamp,
snapshot `id`, `prevIds`, and SHA-256 digests of `snapshot.json` and
`migration.sql`. Also hash the ordered migration list to make one history
digest. Treat these fields as provenance. Do not use them as the cache reset
key.

The generated provenance helps a deployment report answer: “Which database
migration produced this client contract?” It does not apply migrations. Run
`drizzle-kit migrate` and inspect `__drizzle_migrations` for that operation.

Use the public Drizzle Kit SDK in the schema workflow. Read `migration_path`
from `generate()` when it creates a migration. Run `check()` before the
manifest builder accepts the snapshot graph.

### 5. Version the generator contract

Emit an algorithm tag such as `sha256-canonical-json-v2`. A deliberate change
to canonicalization, mapper behavior, or persistence encoding then changes the
tag and forces a controlled cache reset. Keep `replica:check` as the generated
file drift check.

## Compatibility behavior

| Change | Cache action | Database migration action |
| --- | --- | --- |
| Add or remove a selected column | New `cache` number; reset and re-sync | Use the generated Drizzle migration if the database changes |
| Change selected column type or nullability | New `cache` number; reset and re-sync | Apply and record the Drizzle migration |
| Change `where`, shape columns, mapper, or row transform | New `cache` number; reset and re-sync | No database migration unless the database shape changes |
| Change an unrelated auth table | Keep replica `cache` number | Apply and record the auth migration |
| Change only migration folder text or snapshot UUID | Keep `cache` number; update provenance | Drizzle matches and records the migration by its own identity |
| Change SQLite serialization or persistence index contract | New `cache` number; reset and re-sync | No PostgreSQL migration unless the server schema changes |

For a synced collection, the reset is safe because Electric supplies a fresh
snapshot. For a local-only collection, TanStack's mismatch policy can error
instead of resetting. If Canary later needs in-place client data migrations,
it needs an adapter with an explicit migration facility. `schemaVersion` alone
does not provide one.

## Implemented decisions

1. The descriptor field is `cacheVersion`. It states its TanStack DB purpose
   and does not look like a database migration version.
2. Runtime collection indexes are not part of the cache contract. The SQLite
   adapter registers, creates, and removes those indexes independently of row
   cache resets.
3. The full manifest is available from `@canary/db/replica/manifest` for build
   diagnostics. The browser-facing `@canary/db/replica` module imports only a
   compact cache-version map, so migration history does not enter that API.
4. The contract records `electric-snake-camel-v1`,
   `drizzle-zod-date-v1`, and `tanstack-sqlite-json-v1`. A behavior change must
   use a new revision name.
5. The generator resolves and validates the Drizzle snapshot DAG, records the
   complete ordered history, calls the typed Drizzle Kit `generate()` and
   `check()` SDK operations, and writes a deterministic manifest.

## Source set

The external source set is limited to official TanStack DB and ElectricSQL
documentation/source and official Drizzle ORM/Drizzle Kit documentation/source.
Repository claims point to the current Canary files above.
