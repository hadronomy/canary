# Agent instruction research

Research date: 2026-09-25

Scope: guidance for cleaning the repository root `AGENTS.md`. The sources below
are current primary sources from Matt Pocock's skills repository, OpenCode V2,
OpenCode's beta branch, and the Effect V4 repository.

## Findings

### Keep the root file small and behavioral

Matt Pocock's [writing-for-agents guide](https://github.com/mattpocock/skills/blob/main/docs/productivity/writing-for-agents.md)
defines two budgets: context load for material read every turn, and cognitive
load for the person who must find the right document. It recommends progressive
disclosure, explicit pointers for branch-specific material, concrete completion
criteria, and deletion of duplicate or no-op lines.

Apply this to Canary:

- Keep root rules that apply to every change.
- Point to a document only when a task condition makes that document relevant.
- Put package-specific rules beside the package when the rule does not apply to
  the whole repository.
- Delete advice that repeats `package.json`, `justfile`, or nearby code.

### Make source-of-truth pointers explicit

OpenCode V2's [instruction guide](https://opencode.ai/v2/docs/instructions) says
that `AGENTS.md` carries build commands, architecture notes, code conventions,
and verification requirements. It loads the root file and more specific files
as the agent explores a directory. It combines those files instead of resolving
conflicts. OpenCode V2 recognizes `AGENTS.md`; it does not use `CLAUDE.md` as a
fallback.

Use a short root router. For example, point to
`docs/database-workflow.md` for Surrealkit schema work and to
`docs/namespace-imports-and-exports.md` for import or export changes. Do not
copy those documents into the root file. Keep `CLAUDE.md` as a compatibility
symlink only when another harness needs it; treat `AGENTS.md` as the canonical
project file for V2.

The older [OpenCode rules guide](https://dev.opencode.ai/docs/rules/) also
documents lazy, task-specific references and recommends directory-scoped
`AGENTS.md` files for monorepos. The V2 guide is the authority for V2 behavior.

### Use the current repository commands

The current repository source of truth is `package.json`, `justfile`, each
workspace manifest, and `mise.toml`. The root uses Bun `1.4.2` and tracks
`bun.lock`, not `bun.lockb`. The root `justfile` owns Rust and workspace
validation, including `fmt-check`, `lint`, `typecheck`, `test`, `doctest`, and
`check`. Package manifests own focused TypeScript tests and database commands.

Therefore the root guide must name those files and commands only. It must not
claim that an old executable, lockfile, package manager, or local clone is a
required source. Keep command references short and tell the agent to inspect
the affected manifest before it chooses a focused command.

### Copy the workflow shape from OpenCode beta

The [OpenCode beta root `AGENTS.md`](https://github.com/anomalyco/opencode/blob/beta/AGENTS.md)
keeps instructions in layers:

- repository boundaries and generated-client rules;
- the default branch and worktree rules;
- focused commands for live TUI stories;
- semantic UI rules;
- branch and commit conventions;
- concise code and test rules;
- deep V2 architecture facts.

Transfer the shape, not OpenCode's product details. Canary needs explicit
boundaries for Rust versus TypeScript, the two database systems, generated
replica and environment files, Effect 3 versus Effect 4, and the commands that
verify each boundary. V2's use of focused story commands also supports putting
special workflows behind a task-specific pointer instead of loading them for
every change.

### Replace the old Effect workflow with upstream V4 guidance

The current [Effect V4 `.agents/AGENTS.md`](https://github.com/Effect-TS/effect/blob/main/.agents/AGENTS.md)
uses a narrow validation table. It requires nearby-code inspection, targeted
tests, package checks, explicit handling of generated files, and a report of
commands that could not run. It warns that bare `pnpm test` and `pnpm doctest`
start the full suite in watch mode.

Canary should remove the obsolete `effect-solutions` block and old clone paths.
For Effect 4 work, read the upstream [Effect V4 `LLMS.md`](https://github.com/Effect-TS/effect/blob/main/LLMS.md)
and then verify the installed package types and nearby project usage. That
guide recommends `Effect.gen` for inline code, `Effect.fn` or
`Effect.fnUntraced` for reusable effects, `Schema` for validation and domain
models, and `Context.Service` for services. Use these as pointers, not as a
copy of the full upstream guide.

Canary has an important version boundary: most TypeScript packages use Effect 4,
while `apps/tui` uses Effect 3. The root guide must state that boundary and must
tell the agent to inspect the affected package before applying V4 advice.

### Make validation a completion condition

Effect's validation table and OpenCode beta's focused checks both turn a task
into a verifiable loop. Root instructions should require the agent to:

1. inspect the affected code, manifest, and local instructions;
2. choose the narrowest relevant check or test;
3. run broader `just check` only when the change crosses Rust and TypeScript
   boundaries or the task requires it;
4. keep generated files synchronized through their owning command; and
5. report every check run and every check that remained blocked.

This gives each workflow a visible done condition without forcing a full suite
for a small change.

## Recommended root-file shape

Use this order in `AGENTS.md`:

1. one-sentence repository identity and source-of-truth rule;
2. `Before editing` with read-first and focused-validation steps;
3. `Project boundaries` with Rust, TypeScript, database, and generated-file
   ownership;
4. `TypeScript and Effect` with the Effect 3/4 split and upstream V4 pointer;
5. `Verification` with current root and focused commands;
6. a small list of conditional document pointers.

Review every line with Matt Pocock's no-op test: if deleting the line does not
change agent behavior, remove it. Keep external primary-source links in this
research note, not in the operational root file, unless a link is the direct
pointer an agent must follow for a task.

## Local evidence checked

- `package.json`: Bun `1.4.2`, `bun.lock`, Turbo, Oxlint, Oxfmt, Varlock, and
  workspace scripts.
- `justfile`: Rust and workspace recipes, including `check`, focused checks,
  Surrealkit database recipes, and development services.
- `apps/tui/package.json`: Effect 3 dependencies.
- `packages/api/package.json`, `packages/db/package.json`, and
  `apps/web/package.json`: Effect 4 RC dependencies.
- `docs/database-workflow.md`: SurrealDB and Surrealkit lifecycle boundary.
- `docs/namespace-imports-and-exports.md`: Canary's current import/export rule.
