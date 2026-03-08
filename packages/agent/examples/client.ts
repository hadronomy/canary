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

// --- Configuration ---
const edgeToken = process.env.EXAMPLE_AGENT_API_TOKEN ?? "dev-token";
const edgeUserId = process.env.EXAMPLE_AGENT_USER_ID ?? "demo-user";
const contracts = createExampleAgentContracts(getModel("openai-codex", "gpt-5.3-codex"));
type SupportSession = AgentSession<(typeof contracts)["supportAgent"]>;

// --- UI & Styling Engine ---
const theme = {
  primary: "#38bdf8", // Light Blue
  secondary: "#c4b5fd", // Light Purple
  success: "#10b981", // Emerald
  warning: "#f59e0b", // Amber
  error: "#ef4444", // Red
  text: "#f8fafc", // Slate 50
  muted: "#64748b", // Slate 500
  agent: "#34d399", // Mint
  border: "#334155", // Slate 700
};

const ui = {
  banner: (title: string) =>
    console.log(`\n${ansis.bold.bgHex(theme.primary).hex("#0f172a")(`  ${title}  `)}\n`),

  step: (num: number, title: string, desc: string) => {
    console.log(
      ansis.bold.hex(theme.primary)(`\n[Step ${num}] `) + ansis.bold.hex(theme.text)(title),
    );
    console.log(ansis.italic.hex(theme.muted)(`│ ${desc}`));
    console.log(
      ansis.hex(theme.border)("├─────────────────────────────────────────────────────────"),
    );
  },

  prompt: (text: string) =>
    console.log(`${ansis.hex(theme.secondary)("│ User:")}  ${ansis.hex(theme.text)(text)}`),
  info: (text: string) =>
    console.log(
      `${ansis.hex(theme.muted)("│")} ${ansis.hex(theme.primary)("ℹ")} ${ansis.hex(theme.muted)(text)}`,
    ),
  success: (text: string) =>
    console.log(
      `${ansis.hex(theme.muted)("│")} ${ansis.hex(theme.success)("✔")} ${ansis.hex(theme.success)(text)}`,
    ),
  warning: (text: string) =>
    console.log(
      `${ansis.hex(theme.muted)("│")} ${ansis.hex(theme.warning)("⚠")} ${ansis.bold.hex(theme.warning)(text)}`,
    ),

  agentPrefix: () =>
    process.stdout.write(`${ansis.hex(theme.muted)("│")} ${ansis.hex(theme.agent)("Agent:")} `),
  stream: (text: string) => process.stdout.write(ansis.hex(theme.agent)(text)),

  stats: (ttft: number, total: number, chars: number, status: string) => {
    const statusFmt =
      status === "done" ? ansis.hex(theme.success)(status) : ansis.hex(theme.warning)(status);
    console.log(
      ansis.hex(theme.border)(
        `╰─▸ Status:[${statusFmt}] • TTFT: ${ttft}ms • Total: ${total}ms • Chars: ${chars}\n`,
      ),
    );
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Client Initialization with Offset Tracking ---
function createSessionClient() {
  const link = new RPCLink({
    url: "http://localhost:3000",
    headers: async () => ({
      authorization: `Bearer ${edgeToken}`,
      "x-user-id": edgeUserId,
    }),
  });

  const orpc: RouterClient<AppRouter> = createORPCClient(link);

  let streamOffset = 0;

  return createHarnessClient({
    agents: contracts,
    adapter: createORPCAdapter(orpc),
    resume: {
      getOffset: () => streamOffset,
      setOffset: (val) => {
        streamOffset = val;
      },
    },
  });
}

// --- Robust Streaming Helper ---
async function streamTurn(
  session: SupportSession,
  turnId: string,
  controller: AbortController,
  onDelta: (delta: string) => void,
) {
  const views = session.events({ signal: controller.signal });

  let text = "";
  let terminalState = "done";
  let finishedNaturally = false;

  try {
    for await (const event of views) {
      if (event.turnId && event.turnId !== turnId) continue;

      if (event.type === "assistant_text_delta") {
        const delta = (event.payload as any).delta;
        text += delta;
        onDelta(delta);
      } else if (event.type === "turn_done") {
        terminalState = "done";
        finishedNaturally = true;
        break;
      } else if (event.type === "turn_cancelled") {
        terminalState = "cancelled";
        finishedNaturally = true;
        break;
      } else if (event.type === "turn_error") {
        terminalState = "error";
        finishedNaturally = true;
        break;
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError" || controller.signal.aborted) {
      terminalState = "cancelled";
    } else {
      throw err;
    }
  } finally {
    // ALWAYS kill the HTTP connection when we exit the loop
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }

  if (controller.signal.aborted && !finishedNaturally && terminalState !== "error") {
    terminalState = "cancelled";
  }

  return { text, terminalState };
}

// --- Scenarios ---

/**
 * SCENARIO 1: Background Submission & Durable Reconnection
 */
async function demoDurability(client: ReturnType<typeof createSessionClient>, sessionId: string) {
  ui.step(
    1,
    "Durability & Reconnection",
    "Submits a background task, simulates a dropped connection, and reconnects to fetch the result.",
  );

  const session = client.session(sessionId, "supportAgent");
  const prompt = "Explain the concept of 'Durable Execution' in exactly two short sentences.";
  ui.prompt(prompt);

  const startedAt = Date.now();
  ui.info("Submitting task to Restate (Background run)...");

  const { turnId } = await session.submit(
    { question: prompt },
    { idempotencyKey: crypto.randomUUID() },
  );
  ui.success(`Task accepted! Turn ID: ${turnId}`);

  ui.info("Simulating client disconnect (sleeping 3 seconds)...");
  await sleep(3000);

  ui.info("Client reconnected. Fetching durable result from backend...");
  const finalResult = await session.result(turnId);

  ui.info("Syncing event stream offset to catch up with backend...");

  // CRITICAL FIX: We must pass an AbortController so we can sever the SSE connection
  // immediately after `waitForIdle` finishes catching up. Otherwise, the process hangs.
  const idleController = new AbortController();
  await session.waitForIdle({ signal: idleController.signal });
  idleController.abort();

  ui.agentPrefix();
  ui.stream(finalResult.answer + "\n");

  ui.stats(0, Date.now() - startedAt, finalResult.answer.length, "done");
}

/**
 * SCENARIO 2: Real-time Streaming & Mid-Flight Interruption
 */
async function demoInterruption(client: ReturnType<typeof createSessionClient>) {
  const sessionId = `interruption-session-${Date.now()}`;
  ui.step(
    2,
    "Mid-Flight Interruption",
    "Streams a long response and forcibly closes the network connection midway.",
  );

  const session = client.session(sessionId, "supportAgent");
  const prompt =
    "Write a highly detailed, 500-word historical fiction about a space pirate discovering a new galaxy.";
  ui.prompt(prompt);

  const startedAt = Date.now();
  let ttft = 0;
  let chars = 0;
  let isCancelled = false;

  const { turnId } = await session.submit(
    { question: prompt },
    { idempotencyKey: crypto.randomUUID() },
  );
  const controller = new AbortController();

  ui.agentPrefix();

  const { terminalState } = await streamTurn(session, turnId, controller, (delta) => {
    if (isCancelled) return;

    if (ttft === 0) ttft = Date.now() - startedAt;
    ui.stream(delta);
    chars += delta.length;

    if (chars > 150 && !isCancelled) {
      isCancelled = true;
      console.log(); // Break the line cleanly
      ui.warning("User clicked STOP. Dropping SSE connection & sending cancel...");

      session.cancel("User grew impatient and hit stop.").catch(() => {});
      controller.abort();
    }
  });

  if (!isCancelled) console.log();
  ui.stats(ttft, Date.now() - startedAt, chars, terminalState);
}

/**
 * SCENARIO 3: Stateful Continuity (Follow-Up)
 */
async function demoContinuity(
  client: ReturnType<typeof createSessionClient>,
  previousSessionId: string,
) {
  ui.step(
    3,
    "Stateful Continuity & Steering",
    "Reconnects to the session from Step 1 and asks a follow-up question, proving the agent remembers context.",
  );

  const session = client.session(previousSessionId, "supportAgent");

  // Tweak prompt to be more authoritative so the mock/cheap LLM properly answers instead of autocompleting
  const prompt =
    "You just explained Durable Execution. Now, please summarize that exact same explanation, but speak entirely in the persona of a 19th-century space pirate.";
  ui.prompt(prompt);

  const startedAt = Date.now();
  let ttft = 0;
  let chars = 0;

  const { turnId } = await session.submit(
    { question: prompt },
    { idempotencyKey: crypto.randomUUID() },
  );
  const controller = new AbortController();

  ui.agentPrefix();

  const { terminalState } = await streamTurn(session, turnId, controller, (delta) => {
    if (ttft === 0) ttft = Date.now() - startedAt;
    ui.stream(delta);
    chars += delta.length;
  });

  console.log();
  ui.stats(ttft, Date.now() - startedAt, chars, terminalState);
}

// --- Main Execution ---
async function main() {
  console.clear();
  ui.banner("@canary/agent — Interactive Masterclass Demo");

  const statefulClient = createSessionClient();
  const mainSessionId = `persistent-session-${Date.now()}`;

  try {
    await demoDurability(statefulClient, mainSessionId);
    await demoInterruption(createSessionClient());
    await demoContinuity(statefulClient, mainSessionId);

    console.log(ansis.bold.hex(theme.success)("\n✨ Demo completed successfully!\n"));

    // Explicitly exit to guarantee no hanging sockets from external libraries
    process.exit(0);
  } catch (err: any) {
    console.log(ansis.bold.hex(theme.error)(`\n❌ Fatal Error: ${err.message}\n`));
    process.exit(1);
  }
}

void main();
