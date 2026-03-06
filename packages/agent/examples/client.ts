import { getModel } from "@mariozechner/pi-ai";
import ansis from "ansis";

import { createHarnessClient } from "@canary/agent";
import type { AgentSession, AnyEventEnvelope, EventMap } from "@canary/agent";

import { createExampleAgentContracts } from "./shared";

type EventSourceMessage = {
  readonly data: string;
  readonly lastEventId: string;
  readonly type: string;
};

type EventSourceLike = {
  onmessage: ((event: EventSourceMessage) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close: () => void;
};

function createFetchEventSource(url: string): EventSourceLike {
  const controller = new AbortController();

  const source: EventSourceLike = {
    onmessage: null,
    onerror: null,
    close: () => {
      controller.abort();
    },
  };

  void (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const emitFrame = (frame: string): void => {
        let eventType = "message";
        let eventId = "";
        const dataLines: Array<string> = [];

        for (const line of frame.split("\n")) {
          if (line.startsWith("id:")) {
            eventId = line.slice(3).trim();
            continue;
          }

          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (dataLines.length > 0) {
          source.onmessage?.({
            data: dataLines.join("\n"),
            lastEventId: eventId,
            type: eventType,
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) {
            break;
          }

          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.trim().length > 0 && !frame.startsWith(":")) {
            emitFrame(frame);
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        source.onerror?.(error);
      }
    }
  })();

  return source;
}

const edgeToken = process.env.EXAMPLE_AGENT_API_TOKEN ?? "dev-token";
const edgeUserId = process.env.EXAMPLE_AGENT_USER_ID ?? "demo-user";
const sessionId = process.env.EXAMPLE_AGENT_SESSION_ID ?? "session-123";
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

function createConfiguredClient() {
  return createHarnessClient({
    agents: contracts,
    baseUrl: "http://localhost:3000",
    sseOptions: () => ({
      queryParams: {
        token: edgeToken,
        userId: edgeUserId,
      },
    }),
    fetchOptions: () => ({
      headers: {
        authorization: `Bearer ${edgeToken}`,
        "x-user-id": edgeUserId,
      },
    }),
    createEventSource: createFetchEventSource,
  });
}

type ConversationTurn = {
  readonly user: string;
  readonly assistant: string;
};

async function fetchHistory(session: string): Promise<ReadonlyArray<AnyEventEnvelope<EventMap>>> {
  const url =
    `http://localhost:3000/history?sessionId=${encodeURIComponent(session)}` +
    `&token=${encodeURIComponent(edgeToken)}&userId=${encodeURIComponent(edgeUserId)}`;

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${edgeToken}`,
      "x-user-id": edgeUserId,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to fetch history (${response.status}): ${message}`);
  }

  return response.json() as Promise<ReadonlyArray<AnyEventEnvelope<EventMap>>>;
}

function toConversation(
  events: ReadonlyArray<AnyEventEnvelope<EventMap>>,
): ReadonlyArray<ConversationTurn> {
  const turnsById = new Map<
    string,
    {
      user?: string;
      assistant: string;
    }
  >();

  for (const event of events) {
    const turnId = String(event.turnId ?? "");
    if (!turnId) {
      continue;
    }

    const turn = turnsById.get(turnId) ?? { assistant: "" };

    if (event.type === "user_message") {
      turn.user = event.payload.content;
    }

    if (event.type === "assistant_text_delta") {
      turn.assistant += event.payload.delta;
    }

    turnsById.set(turnId, turn);
  }

  const conversation: Array<ConversationTurn> = [];
  for (const turn of turnsById.values()) {
    if (turn.user && turn.assistant.trim().length > 0) {
      conversation.push({ user: turn.user, assistant: turn.assistant.trim() });
    }
  }

  return conversation;
}

function printConversation(title: string, conversation: ReadonlyArray<ConversationTurn>): void {
  console.log(`\n${ui.banner(title)}`);
  if (conversation.length === 0) {
    console.log(ui.subtitle("No prior conversation yet."));
    return;
  }

  let index = 1;
  for (const turn of conversation) {
    printRule();
    console.log(`${ui.title(`#${index}`)} ${ui.user("USER")}`);
    console.log(ansis.hex("#fde68a")(turn.user));
    console.log(`${ui.assistant("ASSISTANT")}`);
    console.log(ansis.hex("#bbf7d0")(turn.assistant));
    index += 1;
  }
  printRule();
}

async function listenForStreaming(
  session: SupportSession,
  label: string,
  previousMaxIndex: number,
): Promise<string> {
  let text = "";
  let sawAny = false;

  for await (const event of session.events()) {
    if (Number(event.index) <= previousMaxIndex) {
      continue;
    }

    if (event.type === "assistant_text_delta") {
      if (!sawAny) {
        sawAny = true;
        process.stdout.write(`\n${ui.title(label)} ${ui.stream("streaming")}: `);
      }

      text += event.payload.delta;
      process.stdout.write(ui.stream(event.payload.delta));
      continue;
    }

    if (
      event.type === "turn_done" ||
      event.type === "turn_error" ||
      event.type === "turn_cancelled"
    ) {
      if (sawAny) {
        process.stdout.write("\n");
      }
      break;
    }
  }

  return text.trim();
}

async function main(): Promise<void> {
  if (twoClientTest) {
    const clientA = createConfiguredClient();
    const sessionA = clientA.session(sessionId, "supportAgent");
    const clientB = createConfiguredClient();
    const sessionB = clientB.session(sessionId, "supportAgent");
    const prompt = "Two-client sync check: reply with EXACTLY 'SYNC-OK'";

    const previousEvents = await fetchHistory(sessionId);
    const previousConversation = toConversation(previousEvents);
    printConversation("Conversation so far:", previousConversation);
    const previousMaxIndex = previousEvents.reduce(
      (max, event) => Math.max(max, Number(event.index)),
      -1,
    );

    console.log(`\n${ui.banner("Two-Client SSE Verification")}`);
    console.log(ui.subtitle("Same auth + same session, both clients should stream deltas."));
    console.log(`${ui.title("Prompt")}: ${ui.prompt(prompt)}`);

    const streamA = listenForStreaming(sessionA, "Client A", previousMaxIndex);
    const streamB = listenForStreaming(sessionB, "Client B", previousMaxIndex);
    const runResult = await sessionA.run({ question: prompt });
    await sessionA.waitForIdle();
    const [textA, textB] = await Promise.all([streamA, streamB]);

    printRule();
    console.log(`${ui.title("Client A final answer")}: ${ui.assistant(runResult.answer)}`);
    console.log(
      `${ui.title("Client A streamed")}: ${textA ? ui.stream(textA) : ui.fail("<empty>")}`,
    );
    console.log(
      `${ui.title("Client B streamed")}: ${textB ? ui.stream(textB) : ui.fail("<empty>")}`,
    );
    const bothReceived = textA.length > 0 && textB.length > 0;
    console.log(
      `${ui.title("Both clients received stream")}: ${bothReceived ? ui.ok("YES") : ui.fail("NO")}`,
    );

    const updatedEvents = await fetchHistory(sessionId);
    const updatedConversation = toConversation(updatedEvents);
    printConversation("Conversation after this run:", updatedConversation);
    return;
  }

  const client = createConfiguredClient();
  const session = client.session(sessionId, "supportAgent");
  const prompt = "Your name is petter";
  console.log(`\n${ui.banner("Single Client Run")}`);
  console.log(`${ui.title("Prompt")}: ${ui.prompt(prompt)}`);
  const first = await session.run({ question: prompt });
  printRule();
  console.log(`${ui.title("Current answer")}: ${ui.assistant(first.answer)}`);
}

void main();
