# Database Workflow

This crate owns **two separate concerns**:

- the Rust runtime integration in [`src/`](./src)
- the Surrealkit schema workflow in [`database/`](./database)

Everything related to Surrealkit lives inside this directory on purpose. That
includes:

- [`surrealkit.toml`](./surrealkit.toml)
- [`database/schema`](./database/schema)
- [`database/rollouts`](./database/rollouts)
- [`database/seed`](./database/seed)
- [`database/snapshots`](./database/snapshots)
- [`database/tests`](./database/tests)
- local Docker workflow in [`compose.yml`](./compose.yml)

The Rust crate in [`src/`](./src) stays focused on runtime concerns. Schema
authoring, rollout history, seed data, and database-specific test suites all
belong to Surrealkit.

The current published Surrealkit CLI expects its project root to be named
`database/`. We keep that convention, but scope it under this crate so the full
workflow still lives inside `crates/database/`.

## Quick start

### 1. Install the local tools

From the repository root:

```sh
mise i
```

### 2. Start SurrealDB

From the repository root:

```sh
docker compose -f crates/database/compose.yml up -d surrealdb
```

### 3. Sync the schema

Using the Mise-managed binary:

```sh
cd crates/database
cp .env.example .env
mise exec -- surrealkit sync
```

### 4. Seed or test

```sh
cd crates/database
cp .env.example .env
mise exec -- surrealkit seed
mise exec -- surrealkit test
```

## Workflow guidance

- Use `sync` for local and disposable databases.
- Use `rollout` for shared and production databases.
- Keep schema changes in `database/schema/*.surql`.
- Keep rollout manifests in `database/rollouts/`.
- Keep seed files in `database/seed/*.surql`.
- Keep declarative test suites in `database/tests/suites/*.toml`.
- Keep runtime connection logic in Rust code, not in schema files.

## Local environment

Start from [`.env.example`](./.env.example) and create a local `.env` if you
want to override the default local connection settings:

The default local assumptions are:

- SurrealDB is listening on `127.0.0.1:8000`
- namespace: `canary`
- database: `app`
- root credentials: `root` / `root`
- Surrealkit project root: `./database`
