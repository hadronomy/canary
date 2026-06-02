# Canary database

This crate is Canary's SurrealDB boundary.

It holds two things that belong together, but should not be mixed together:

- the Rust runtime integration in [`src/`](./src)
- the schema project managed with Surrealkit in [`database/`](./database)

The Rust side owns connection setup, authentication, health checks, and the
application-facing database handle. The Surrealkit side owns schema files,
rollouts, seed data, snapshots, and database-focused test suites.

## Layout

```text
crates/database/
  src/                 # Rust runtime API
  tests/               # Rust integration checks for the crate
  surrealkit.toml      # Surrealkit project config
  compose.yml          # Local SurrealDB workflow
  .env.example         # Local Surrealkit environment template
  database/
    schema/            # Desired schema
    rollouts/          # Reviewed schema changes for shared environments
    seed/              # Seed data
    snapshots/         # Generated Surrealkit snapshots
    tests/             # Declarative Surrealkit suites
    setup.surql        # Shared setup applied before schema
```

## What this crate is for

Use this crate when you need to:

- load validated SurrealDB configuration
- open a database handle for the server runtime
- create explicit sessions
- keep the runtime and schema lifecycle separate

Do not use this crate as an ad hoc migration runner. Schema lifecycle work
lives in Surrealkit.

## Local development

Install the repo-managed toolchain from the repository root:

```sh
mise i
```

Start the local database:

```sh
just db-up
```

Sync the desired schema:

```sh
just db-sync
```

Seed or test it if you need a fuller local setup:

```sh
just db-seed
just db-test
```

Check the current rollout state:

```sh
just db-status
```

## Working on schema

For local and disposable environments:

- edit `database/schema/*.surql`
- run `surrealkit sync`
- use `surrealkit sync --watch` when you want a tight feedback loop

For shared or production environments:

- create and review rollouts under `database/rollouts/`
- use Surrealkit's rollout flow instead of applying changes informally

That split is important. Canary treats the runtime database API and the schema
lifecycle as separate concerns on purpose.

## Local environment

Start from [`.env.example`](./.env.example) if you want a crate-local `.env`.

The default local assumptions are:

- SurrealDB is listening on `127.0.0.1:8000`
- namespace: `canary`
- database: `app`
- root credentials: `root` / `root`
- Surrealkit project root: `./database`
