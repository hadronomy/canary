<!-- effect-solutions:start -->

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1;
function journal(dir: string) {}

// Bad
const fooBar = 1;
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, 'journal.json')).json();

// Bad
const journalPath = path.join(dir, 'journal.json');
const journal = await Bun.file(journalPath).json();
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a;
obj.b;

// Bad
const { a, b } = obj;
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2;

// Bad
let foo;
if (condition) foo = 1;
else foo = 2;
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1;
  return 2;
}

// Bad
function foo() {
  if (condition) return 1;
  else return 2;
}
```

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

## Database Best Practices (SurrealDB + Surrealkit)

**IMPORTANT:** Keep schema lifecycle work in `crates/database/database/` and
runtime connection logic in the Rust `database` crate.

1. Edit schema files under `crates/database/database/schema/`
2. Use Surrealkit for schema sync, rollouts, seeds, and DB-focused tests
3. Keep rollout history in `crates/database/database/rollouts/`
4. Use the repo Justfile for local DB workflows such as `just db-sync`,
   `just db-test`, and `just db-status`

**Anti-patterns to avoid:**

- ❌ Turning the application runtime into a migration runner
- ❌ Mixing runtime connection code with schema lifecycle files
- ❌ Hiding schema changes in ad hoc startup scripts

**When to use raw SQL / SurrealQL directly:**

- SurrealQL queries that are part of the runtime data model
- Storage- or engine-specific performance tuning that belongs in schema files
- Data backfills or one-off repair scripts that are clearly operational, not
  part of request handling

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
