# Namespace imports and namespace exports

This note compares `import * as` with `export * as`. It uses fresh source
snapshots from Effect v4 and the OpenCode v2 beta branch.

- Effect: `4.0.0-rc.115`, commit
  [`755e863`](https://github.com/Effect-TS/effect/tree/755e863a793e5621183e7992cb3f85d29030ad7b)
  from 12 September 2026.
- OpenCode: `2.0.0`, beta commit
  [`0f26ad8`](https://github.com/anomalyco/opencode/tree/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5)
  from 11 September 2026.

## Conclusion

`import * as` and `export * as` do different jobs.

```ts
// A caller creates a local namespace binding.
import * as Run from "./runner.js";

// A producer publishes another module as one named export.
export * as Run from "./runner.js";
```

Effect uses both forms in their direct roles. Its implementation modules use
namespace imports. Its generated entry points use namespace exports. Effect
does not self-export a module from that same module.

OpenCode v2 adds a third pattern. A module exports its own namespace, and its
callers use a named import:

```ts
// runner.ts
export * as Run from "./runner.js";

// caller.ts
import { Run } from "./runner.js";
```

OpenCode pairs this pattern with a project rule against all namespace imports.
The self-export lets each module provide a producer-owned namespace name without
a star import at the call site.

For Canary, keep the current Effect-style direct imports:

```ts
import * as Run from "@canary/api/runner";
```

Do not restore `export * as Run` inside `runner.ts` unless Canary also adopts
OpenCode's no-star-import rule across the project. If Canary needs a package
root facade, put `export * as Run from "./runner"` in `src/index.ts`. That is a
real package boundary and the normal purpose of the syntax.

## What the syntax means

The forms differ by owner and API effect.

| Form                              | Owner              | Result                                                                              |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `import * as Run from "./runner"` | Caller             | Adds one local binding. It does not change the source module's API.                 |
| `export * as Run from "./runner"` | Producer or barrel | Adds `Run` to the producer's public exports. It does not add a local `Run` binding. |
| `export * from "./runner"`        | Producer or barrel | Flattens the source module's exports into the producer.                             |

TypeScript documents `export * as ns` as shorthand for importing a module
namespace and then exporting that namespace from an entry point. It also states
that `import type` is erased from runtime output. See the TypeScript 3.8 notes
for
[`export * as ns`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#export--as-ns-syntax)
and
[type-only imports](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-export).

A self-export has one unusual result. The namespace contains the namespace
export itself:

```ts
// runner.ts
export * as Run from "./runner.js";
export const start = () => {};

// caller.ts
import { Run } from "./runner.js";

Run.start();
Run.Run === Run; // true
```

This recursive member exists in OpenCode's canonical namespace pattern. Effect
avoids it because it only uses `export * as` across a real module boundary.

## Effect v4

Effect has a clear split between public entry points and implementation files.

### Public entry points publish namespaces

The root `effect` entry point exports `Array`, `Cause`, `Effect`, and other
modules as named namespaces. The file marks these exports as generated. See
[`packages/effect/src/index.ts`](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/effect/src/index.ts#L32-L42).

The package map exposes that root file, direct module paths such as
`effect/Effect`, and grouped entry points such as `effect/testing`. See
[`packages/effect/package.json`](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/effect/package.json#L28-L58).

This supports the public form used throughout Effect's documentation:

```ts
import { Effect, Queue } from "effect";
```

Grouped entry points keep the same structure. For example, `effect/testing`
exports `TestClock`, `TestConsole`, and `TestSchema` as namespaces. See
[`packages/effect/src/testing/index.ts`](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/effect/src/testing/index.ts#L5-L20).

### Implementation files consume direct modules as namespaces

`Effect.ts` imports runtime modules such as `Context`, `Duration`, `Exit`, and
several internal modules with `import * as`. It also uses `import type * as` for
large type surfaces such as `Cause`, `Layer`, and `Result`. It uses named imports
when it needs a small exact set. See
[`packages/effect/src/Effect.ts`](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/effect/src/Effect.ts#L13-L75).

Effect also has an internal lint rule against importing from package barrels.
Its test expects `import * as Effect from "effect/Effect"` instead of
`import { Effect } from "effect"` in checked implementation code. See the
[`no-import-from-barrel-package` tests](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/tools/oxc/test/no-import-from-barrel-package.test.ts#L39-L55).

This split gives external callers a compact package API while implementation
files keep direct dependency edges.

### Source count

A line and path scan of `packages/effect/src` found:

- 3,277 namespace imports across 476 TypeScript files.
- 2,680 value namespace imports and 597 type-only namespace imports.
- 343 namespace exports, all in 22 `index.ts` files.
- No self namespace exports. All 343 cross a module boundary.
- Four flat `export * from` declarations.

The count confirms the architecture visible in the representative files. It is
not a claim that every line follows one mandatory public style.

## OpenCode v2 beta

OpenCode chooses a different project-wide import rule.

### Namespace imports are forbidden

Its root instructions say:

- Do not alias imports.
- Do not use `import * as` or `import type * as`.
- Import a module's own exported namespace by name when qualified access is
  useful.

See [`AGENTS.md`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/AGENTS.md#L84-L90).

An AST rule encodes the ban, and its tests list `export * as Foo` as valid while
both star-import forms are invalid. See the
[`no-star-import` rule](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/script/ast-grep/rules/no-star-import.yml#L1-L10)
and its
[`rule test`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/script/ast-grep/rule-tests/no-star-import-test.yml#L1-L8).

The written rule first appeared in May 2026 in
[`7f571d3`](https://github.com/anomalyco/opencode/commit/7f571d36ea56cc3dd7059cfe82c729fb52b121eb).
The AST check followed in July in
[`1401901`](https://github.com/anomalyco/opencode/commit/14019015292f19bddd5665cc7bcdae93744e91ad).

### Modules publish their own canonical namespace

`project.ts` starts with a self-export:

```ts
export * as Project from "./project.js";
```

Callers then use `import { Project } from "../project.js"`. See
[`project.ts`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/core/src/project.ts#L1-L20)
and one
[`Session` caller](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/core/src/session/move.ts#L1-L16).

The `@opencode/core` package maps each public subpath directly to a source file.
For example, `@opencode/core/project` resolves to `src/project.ts`. The named
`Project` import therefore comes from the module's self-export, not from a root
barrel. See
[`packages/core/package.json`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/core/package.json#L29-L31).

The same pattern appears in smaller modules. `run-coordinator.ts` exports
`SessionRunCoordinator` from itself. `execution.ts` imports that named
namespace and uses it as a qualified module. See
[`run-coordinator.ts`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/core/src/session/run-coordinator.ts#L1-L15)
and
[`execution.ts`](https://github.com/anomalyco/opencode/blob/0f26ad8787ffed233aeaf5ab2f4efb0241b13bf5/packages/core/src/session/execution.ts#L1-L12).

OpenCode also consumes Effect through Effect's public barrel:

```ts
import { Context, Effect, Layer, Schema } from "effect";
```

This is consistent with OpenCode's own rule, even though Effect's internal lint
rule prefers direct namespace imports in the Effect repository.

### Source count

A comparable scan of `packages/core/src` found:

- 15 remaining namespace imports across 429 TypeScript files.
- 242 namespace exports.
- 236 exact self namespace exports.
- Six other namespace exports.
- 20 flat `export * from` declarations.

The 15 star imports are concentrated in the embedded Effect-Drizzle SQLite
code. Across every `packages/*/src` directory, 63 star imports remain. This
means the beta snapshot does not have zero violations, even though the written
rule and the AST rule are clear.

## Trade-offs

### Namespace ownership

`import * as` lets each caller choose the local name. This is simple, but two
callers can choose different names for the same module.

The OpenCode self-export gives the producer control over the namespace name.
That supports its ban on aliased imports and keeps domain names consistent.

### Public API size

A direct namespace import does not change the producer's API.

A self namespace export adds a second path to every export. A caller can import
`start` directly or reach it through `Run.start`. Each new direct export also
becomes part of `Run` automatically. The recursive `Run.Run` member is part of
that surface too.

A namespace export from a separate barrel does not have this recursive shape.
It gives the package one grouped export and avoids name collisions between
modules.

### Dependency boundaries

Direct namespace imports make the source dependency explicit. Effect reinforces
this with its no-barrel-import lint rule.

A package barrel gives callers a smaller set of entry points, but it can hide
which source module owns a name. Effect uses generated barrels for public APIs
and direct paths inside its implementation.

### Bundling

Both forms are static ESM syntax. Neither form has a general tree-shaking win.
Namespace property access and barrel traversal can change what a specific
bundler retains. Static property access is easier to analyze than computed
access. Measure the built application before using bundle size as the deciding
factor.

Effect declares `"sideEffects": []` and still uses namespace imports and
namespace-export barrels together. This supports the view that the main choice
here is API structure, not a universal runtime optimization. See
[`packages/effect/package.json`](https://github.com/Effect-TS/effect/blob/755e863a793e5621183e7992cb3f85d29030ad7b/packages/effect/package.json#L28-L32).

## Decision rule for Canary

Use these rules unless Canary adopts a different project-wide convention:

1. Use `import * as Run from "@canary/api/runner"` for a direct module
   dependency that needs many qualified members.
2. Use named imports when a caller needs a small exact set.
3. Use `export * as Run from "./runner"` in a package or feature entry point
   when the entry point must publish the whole module as one group.
4. Do not put a self-export in `runner.ts` only to replace `import * as` at its
   callers.
5. If the team prefers OpenCode's convention, adopt the full convention: add
   canonical self-exports to domain modules, convert callers to named imports,
   and enforce the rule. A partial conversion gives Canary two ways to express
   the same dependency without a clear boundary.

The current Run code follows rule 1 in
[`packages/api/src/runtime.ts`](../packages/api/src/runtime.ts) and the route
modules. The removal of the old self-export from
[`packages/api/src/runner.ts`](../packages/api/src/runner.ts) is coherent with
that choice.

## Method

The source counts use anchored searches for `import * as`, `import type * as`,
`export * as`, and `export * from`. A path-resolution check classifies a
namespace export as a self-export when its relative target resolves to the file
that contains it. Generated files, checked-in adapted code, and remaining lint
violations stay in the counts because they are part of each referenced source
snapshot.
