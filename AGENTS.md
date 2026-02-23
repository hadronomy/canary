<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Use the local Effect source clone for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect repository is cloned to `~/code/opensource/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## Effect primitive guides (proposal docs)

When working with Effect primitives referenced in `docs/*`, consult these focused guides first:

- `docs/effect-primitives/Effect.md`
- `docs/effect-primitives/Effect.fn.md`
- `docs/effect-primitives/Effect.Service.md`
- `docs/effect-primitives/Layer.md`
- `docs/effect-primitives/Schema.md`
- `docs/effect-primitives/Stream.md`
- `docs/effect-primitives/Schedule.md`
- `docs/effect-primitives/Chunk.md`
- `docs/effect-primitives/Option.md`
- `docs/effect-primitives/Data.TaggedError.md`
- `docs/effect-primitives/HashMap.md`

<!-- effect-solutions:end -->

## Opentui best practices

The opentui repository is cloned to `~/code/opensource/opentui` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## Effect-Atom best practices and state management

The effect-atom repository is cloned to `~/code/opensource/effect-atom` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## Opencode reference and Opentui best practices

The opencode repository is cloned to `~/code/opensource/opencode/src/cli/cmd/tui` for reference.
Use this as an important reference implementation with opentui best practices.

## Code style

- Always use the path alias for relative paths `~/*` -> `./src/*`
- Prefer `function` declarations for named reusable functions.
- Exception: when defining Effect-based service/runtime operations, prefer `const x = Effect.fn("...")` for traceable spans and ergonomic composition.
- In test directories, extract repeated fixture/parser helpers into a local shared module (for example `test/collectors/<domain>/common.ts`) and import from there.

## Database Best Practices (Drizzle)

**IMPORTANT:** Never write manual SQL migrations.

1. Update the TypeScript Drizzle schema files (in `packages/db/src/schema/`)
2. Run `bun db:generate` (or equivalent) to auto-generate migrations
3. Review the generated migration files before applying
4. Run `bun db:migrate` to apply migrations

**Anti-patterns to avoid:**

- ❌ Writing `.sql` migration files manually
- ❌ Editing generated migration files (unless fixing a bug)
- ❌ Using raw SQL for schema changes when Drizzle DSL can express them

**When to use raw SQL:**

- Complex PostgreSQL-specific features not yet supported by Drizzle
- Performance optimizations requiring custom indexes
- Data migrations/transformations (not schema changes)

## Dependency Management

**Always use `bun add` to install dependencies.** Never manually edit `package.json`.

**Adding production dependencies:**

```bash
bun add <package-name>
```

**Adding development dependencies:**

```bash
bun add -d <package-name>
```

**Anti-patterns to avoid:**

- ❌ Manually editing `package.json` to add dependencies
- ❌ Manually editing `package.json` to add version numbers
- ❌ Using `npm install` or `pnpm add` (inconsistent lockfiles)

**Why this matters:**

- `bun add` updates both `package.json` AND `bun.lockb` consistently
- Manual edits can lead to lockfile desynchronization
- Version resolution and peer dependency handling is done correctly
