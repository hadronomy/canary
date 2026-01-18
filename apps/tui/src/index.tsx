import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Effect } from "effect";

import { App } from "./app";

async function runTui() {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App />);
}

const canary = Command.make("canary", {}, () => {
  return Effect.tryPromise(runTui);
});

const cli = Command.run(canary, {
  name: "canary",
  version: "1.0.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
