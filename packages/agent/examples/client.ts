import { getModel } from "@mariozechner/pi-ai";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import ansis from "ansis";

import type { AgentSession } from "@canary/agent";
import { createHarnessClient } from "@canary/agent";
import { createORPCAdapter } from "@canary/agent/adapters/orpc";

import type { AppRouter } from "./server";
import { createExampleAgentContracts } from "./shared";

const edgeToken = process.env.EXAMPLE_AGENT_API_TOKEN ?? "dev-token";
const edgeUserId = process.env.EXAMPLE_AGENT_USER_ID ?? "demo-user";
const sessionId = process.env.EXAMPLE_AGENT_SESSION_ID ?? `session-${Date.now()}`;
const twoClientTest = (process.env.EXAMPLE_AGENT_TWO_CLIENT_TEST ?? "true") === "true";

const contracts = createExampleAgentContracts(getModel("openai-codex", "gpt-5.3-codex"));
type SupportSession = AgentSession<(typeof contracts)["supportAgent"]>;

const ui = {
  banner: (value: string) => ansis.bold.bgHex("#0f172a").hex("#f8fafc")(` ${value} `),
  title: (value: string) => ansis.bold.hex("#38bdf8")(value),
  subtitle: (value: string) => ansis.hex("#94a3b8")(value),
  user: (value: string) => ansis.bold.hex("#f59e0b")(value),
  assistant: (value: string) => ansis.bold.hex("#34d399")(value),
  stream: (value: string) => ansis.hex("#22d3ee")(value),
  ok: (value: string) => ansis.bold.hex("#10b981")(value),
  fail: (value: string) => ansis.bold.hex("#ef4444")(value),
  prompt: (value: string) => ansis.hex("#a78bfa")(value),
};

function printRule(): void {
  console.log(ansis.hex("#334155")("─".repeat(72)));
}

function logDeltaLive(options: {
  readonly label: string;
  readonly startedAtMs: number;
  readonly index: number;
  readonly delta: string;
}): void {
  const elapsedMs = Date.now() - options.startedAtMs;
  const payload = JSON.stringify(options.delta);
  console.log(
    `${ui.subtitle(`[${elapsedMs}ms]`)} ${ui.title(options.label)} idx=${options.index} delta(${options.delta.length}): ${ui.stream(payload)}`,
  );
}

function createConfiguredClient() {
  const link = new RPCLink({
    url: "http://localhost:3000",
    headers: async () => ({
      authorization: `Bearer ${edgeToken}`,
      "x-user-id": edgeUserId,
    }),
  });

  const orpc: RouterClient<AppRouter> = createORPCClient(link);

  return createHarnessClient({
    agents: contracts,
    adapter: createORPCAdapter(orpc),
  });
}

async function listenForStreaming(
  session: SupportSession,
  label: string,
  startedAtMs: number,
): Promise<string> {
  let text = "";
  let sawAny = false;
  const controller = new AbortController();

  try {
    for await (const event of session.events({ signal: controller.signal })) {
      if (event.type === "assistant_text_delta") {
        if (!sawAny) {
          sawAny = true;
          console.log(`${ui.title(label)} TTFT: ${ui.ok(`${Date.now() - startedAtMs}ms`)}`);
          console.log(`${ui.title(label)} ${ui.stream("streaming")}:`);
        }

        text += event.payload.delta;
        logDeltaLive({
          label,
          startedAtMs,
          index: Number(event.index),
          delta: event.payload.delta,
        });
        continue;
      }

      if (
        event.type === "turn_done" ||
        event.type === "turn_error" ||
        event.type === "turn_cancelled"
      ) {
        controller.abort();
        break;
      }
    }
  } finally {
    controller.abort();
  }

  return text.trim();
}

async function runTwoClientVerification(): Promise<void> {
  const clientA = createConfiguredClient();
  const sessionA = clientA.session(sessionId, "supportAgent");
  const clientB = createConfiguredClient();
  const sessionB = clientB.session(sessionId, "supportAgent");
  const prompt = "Two-client sync check: reply with EXACTLY 'SYNC-OK'";

  console.log(`\n${ui.banner("Two-Client SSE Verification")}`);
  console.log(ui.subtitle("Same auth + same session, both clients should stream deltas."));
  console.log(`${ui.title("Prompt")}: ${ui.prompt(prompt)}`);

  const startedAtMs = Date.now();
  const streamA = listenForStreaming(sessionA, "Client A", startedAtMs);
  const streamB = listenForStreaming(sessionB, "Client B", startedAtMs);
  const runResult = await sessionA.run({ question: prompt });
  const [textA, textB] = await Promise.all([streamA, streamB]);

  printRule();
  console.log(`${ui.title("Client A final answer")}: ${ui.assistant(runResult.answer)}`);
  console.log(`${ui.title("Client A streamed")}: ${textA ? ui.stream(textA) : ui.fail("<empty>")}`);
  console.log(`${ui.title("Client B streamed")}: ${textB ? ui.stream(textB) : ui.fail("<empty>")}`);
  const bothReceived = textA.length > 0 && textB.length > 0;
  console.log(
    `${ui.title("Both clients received stream")}: ${bothReceived ? ui.ok("YES") : ui.fail("NO")}`,
  );

  await runLongEssayBenchmark();
}

async function runLongEssayBenchmark(): Promise<void> {
  const client = createConfiguredClient();
  const benchmarkSessionId = `${sessionId}-long-essay-${Date.now()}`;
  const session = client.session(benchmarkSessionId, "supportAgent");
  const prompt =
    "Write a concise essay (about 300 words) on the evolution of distributed systems, including key trade-offs and modern best practices.";

  console.log(`\n${ui.banner("Long Essay Benchmark")}`);
  console.log(ui.subtitle("Fresh session to measure TTFT and total generation time."));
  console.log(`${ui.title("Session")}: ${benchmarkSessionId}`);
  console.log(`${ui.title("Prompt")}: ${ui.prompt(prompt)}`);

  const startedAtMs = Date.now();
  let ttftMs: number | null = null;
  let streamedChars = 0;
  let sawAny = false;
  const controller = new AbortController();
  const progressTimer = setInterval(() => {
    const elapsed = Date.now() - startedAtMs;
    console.log(ui.subtitle(`Long Essay elapsed: ${elapsed}ms`));
  }, 5000);

  const streamPromise = (async () => {
    try {
      for await (const event of session.events({ signal: controller.signal })) {
        if (event.type === "assistant_text_delta") {
          if (ttftMs === null) {
            ttftMs = Date.now() - startedAtMs;
            console.log(`${ui.title("Long Essay")} TTFT: ${ui.ok(`${ttftMs}ms`)}`);
            console.log(ui.subtitle("Streaming long answer..."));
          }

          if (!sawAny) {
            sawAny = true;
            console.log(`\n${ui.title("Long Essay")} ${ui.stream("streaming")}:`);
          }

          streamedChars += event.payload.delta.length;
          logDeltaLive({
            label: "Long Essay",
            startedAtMs,
            index: Number(event.index),
            delta: event.payload.delta,
          });
          continue;
        }

        if (
          event.type === "turn_done" ||
          event.type === "turn_error" ||
          event.type === "turn_cancelled"
        ) {
          controller.abort();
          break;
        }
      }
    } finally {
      controller.abort();
    }
  })();

  let result: Awaited<ReturnType<SupportSession["run"]>>;
  try {
    result = await session.run({ question: prompt });
    await streamPromise;
  } finally {
    clearInterval(progressTimer);
  }
  const totalMs = Date.now() - startedAtMs;

  if (ttftMs === null) {
    ttftMs = totalMs;
  }

  printRule();
  console.log(`${ui.title("Long Essay total time")}: ${ui.ok(`${totalMs}ms`)}`);
  console.log(`${ui.title("Long Essay TTFT")}: ${ui.ok(`${ttftMs}ms`)}`);
  if (streamedChars === 0) {
    console.log(
      ui.subtitle(
        "No realtime delta tokens were observed for this run; response arrived at completion.",
      ),
    );
  }
  console.log(`${ui.title("Streamed chars")}: ${ui.stream(String(streamedChars))}`);
  console.log(`${ui.title("Final answer chars")}: ${ui.assistant(String(result.answer.length))}`);
}

async function runSingleClient(): Promise<void> {
  const client = createConfiguredClient();
  const session = client.session(sessionId, "supportAgent");
  const prompt = "Your name is petter";
  console.log(`\n${ui.banner("Single Client Run")}`);
  console.log(`${ui.title("Prompt")}: ${ui.prompt(prompt)}`);

  const startedAtMs = Date.now();
  const stream = listenForStreaming(session, "Client", startedAtMs);
  const result = await session.run({ question: prompt });
  await stream;

  printRule();
  console.log(`${ui.title("Current answer")}: ${ui.assistant(result.answer)}`);
}

async function main(): Promise<void> {
  if (twoClientTest) {
    await runTwoClientVerification();
    return;
  }

  await runSingleClient();
}

void main();
