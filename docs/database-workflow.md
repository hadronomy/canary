# Database Workflow

This project keeps **runtime database code** and **schema workflow code** in
separate lanes.

- The [`database`](/Users/hadronomy/repos/canary/crates/database/src/lib.rs)
  crate owns connection setup, authentication, health checks, and the runtime
  handle used by the application.
- **Surrealkit** owns schema sync, rollout planning, seed data, snapshots, and
  database-focused test suites.

That boundary is intentional. The runtime should know _how to connect_ and
_how to query_; schema lifecycle work should stay in Surrealkit.

## Layout

All Surrealkit state lives under
[`crates/database`](/Users/hadronomy/repos/canary/crates/database):

```text
crates/database/
  surrealkit.toml
  compose.yml
  .env.example
  database/
    schema/
    rollouts/
    seed/
    snapshots/
    tests/
```

The important rule is simple:

- **runtime code lives in Rust modules**
- **schema workflow lives in `crates/database/database/`**

## Local development

Use the desired-state workflow for disposable or developer-owned databases:

1. Edit `crates/database/database/schema/*.surql`
2. Run `surrealkit sync`
3. For active local work, run `surrealkit sync --watch`

Install the local tooling first:

```sh
mise i
```

From the repository root, the containerized path is:

```sh
docker compose -f crates/database/compose.yml up -d surrealdb
```

Then work from the crate directory so the project-local config and `.env` are
picked up naturally:

```sh
cd crates/database
cp .env.example .env
mise exec -- surrealkit sync
```

## Shared and production databases

Use the rollout workflow when schema changes need review, staged execution, or
rollback:

1. `surrealkit rollout baseline`
2. `surrealkit rollout plan --name <change>`
3. Review `crates/database/database/rollouts/*.toml`
4. `surrealkit rollout start <rollout>`
5. Cut the application over
6. `surrealkit rollout complete <rollout>`

If a rollout must be backed out, use:

```sh
surrealkit rollout rollback <rollout>
```

## Seed data

Use:

```sh
cd crates/database
cp .env.example .env
mise exec -- surrealkit seed
```

Keep seed data in `crates/database/database/seed/`. Seed data helps local
setup and integration testing; it should not quietly behave like schema.

## Database-focused tests

Use:

```sh
cd crates/database
cp .env.example .env
mise exec -- surrealkit test
```

Suites live in `crates/database/database/tests/`. This is the right home for
schema assertions, permissions checks, SQL expectations, and API smoke tests.

## Guardrails worth keeping

- Use `sync` for local and disposable environments.
- Use `rollout` for shared and production environments.
- Keep destructive schema changes out of the application runtime.
- Do not turn the runtime crate into a migration runner.
- Keep runtime connection config and schema workflow config separate, even when
  both point at the same database.
