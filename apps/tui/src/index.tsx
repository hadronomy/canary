import { RegistryProvider } from "@effect-atom/atom-react";
import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Effect } from "effect";

import { App } from "~/app";
import {
  activeViewAtom,
  cmdkOpenAtom,
  cmdkQueryAtom,
  debugModeAtom,
  debugToastAtom,
  debugToastVisibleAtom,
  helpOpenAtom,
  queryAtom,
} from "~/app/state";

async function runTui(initialView: "main" | "dashboard" = "main") {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <RegistryProvider
      initialValues={[
        [queryAtom, ""],
        [cmdkOpenAtom, false],
        [cmdkQueryAtom, ""],
        [helpOpenAtom, false],
        [debugModeAtom, false],
        [debugToastAtom, ""],
        [debugToastVisibleAtom, false],
        [activeViewAtom, initialView],
      ]}
      scheduleTask={(f) => setTimeout(f, 0)}
      timeoutResolution={50}
    >
      <App />
    </RegistryProvider>,
  );
}

const openDashboard = Command.make("dashboard", {}, () => {
  return Effect.tryPromise(() => runTui("dashboard"));
}).pipe(Command.withDescription("Open control center dashboard"));

const openSearch = Command.make("search", {}, () => {
  return Effect.tryPromise(() => runTui("main"));
}).pipe(Command.withDescription("Open search view"));

const canary = Command.make("canary", {}, () => Effect.tryPromise(() => runTui()))
  .pipe(Command.withDescription("Search all the canary islands laws and regulations"))
  .pipe(Command.withSubcommands([openDashboard, openSearch]));

const cli = Command.run(canary, {
  name: "canary",
  version: "1.0.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
