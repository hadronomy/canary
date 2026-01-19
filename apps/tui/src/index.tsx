import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { RegistryProvider } from "@effect-atom/atom-react";
import { Effect } from "effect";

import { App } from "~/app";
import {
  cmdkOpenAtom,
  cmdkQueryAtom,
  debugModeAtom,
  debugToastAtom,
  debugToastVisibleAtom,
  helpOpenAtom,
  queryAtom,
} from "~/app/state";

async function runTui() {
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
      ]}
      scheduleTask={(f) => setTimeout(f, 0)}
      timeoutResolution={50}
    >
      <App />
    </RegistryProvider>,
  );
}

const canary = Command.make("canary", {}, () => {
  return Effect.tryPromise(runTui);
}).pipe(Command.withDescription("Search all the canary islands laws and regulations"));

const cli = Command.run(canary, {
  name: "canary",
  version: "1.0.0",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
