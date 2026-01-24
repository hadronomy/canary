# Seeder Daemon + CLI EntryPoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a daemon scheduler for the Seeder and a CLI entrypoint in `apps/server` to run it manually or as a background process.

**Architecture:**

- **SeederDaemon:** an Effect workflow wrapping `SeederWorkflow.runSeeder` with scheduling and backoff.
- **CLI Entry:** a lightweight `apps/server/src/cli/seeder.ts` that exposes `run` and `daemon` modes.
- **Server Integration:** export the daemon in `apps/server/src/index.ts` for programmatic use.

**Tech Stack:** Effect-TS, @effect/cli, Bun.

### Task 1: Seeder Daemon Effect

**Files:**

- Create: `apps/server/src/workflows/seeder-daemon.ts`
- Test: `apps/server/test/workflows/seeder-daemon.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Schedule } from "effect";
import { SeederDaemon } from "../../src/workflows/seeder-daemon";

it("runs seeder with schedule", async () => {
  const calls = await Effect.runPromise(Ref.make(0));
  const MockSeeder = Layer.succeed(SeederDaemon.Seeder, {
    run: () => Ref.update(calls, (n) => n + 1),
  });

  await Effect.runPromise(
    SeederDaemon.runScheduled(Schedule.recurs(1)).pipe(Effect.provide(MockSeeder)),
  );

  expect(await Effect.runPromise(Ref.get(calls))).toBe(2);
});
```

**Step 2: Run test to verify it fails**
Run: `bun test apps/server/test/workflows/seeder-daemon.test.ts`
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

- Create `SeederDaemon` with:
  - `runOnce: Effect<void>`
  - `runScheduled(schedule: Schedule)`
- Use `Effect.repeat`.

**Step 4: Run test to verify it passes**
Run: `bun test apps/server/test/workflows/seeder-daemon.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/workflows/seeder-daemon.ts apps/server/test/workflows/seeder-daemon.test.ts
git commit -m "feat(seeder): add seeder daemon scheduler"
```

### Task 2: CLI EntryPoint

**Files:**

- Create: `apps/server/src/cli/seeder.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/cli/seeder.test.ts`

**Step 1: Write failing test**

```ts
it("runs seeder in run mode", async () => {
  // stub CLI args + verify SeederWorkflow.runSeeder called
});
```

**Step 2: Implement CLI**

- Add a `seeder` command with subcommands:
  - `run --startYear 1983 --endYear 2024`
  - `daemon`
- Use `@effect/cli` for parsing.

**Step 3: Wire index**

- Export `SeederDaemon` from `apps/server/src/index.ts`.
- If `process.argv` includes `seeder`, execute CLI.

**Step 4: Run tests**
Run: `bun test apps/server/test/cli/seeder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/cli/seeder.ts apps/server/src/index.ts apps/server/test/cli/seeder.test.ts
git commit -m "feat(seeder): add CLI entrypoint"
```
