import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { getModel, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai";
import * as restate from "@restatedev/restate-sdk";

import {
  createHarness,
  createRestateApi,
  toSessionId,
  type ContextStore,
  type EventMap,
  type HarnessRunResponse,
  type HarnessSessionSnapshot,
  type RestateApi,
} from "@canary/agent";

import { createExampleAgents } from "./shared";

const AUTH_FILE_URL = new URL("./auth.json", import.meta.url);

interface StoredAuth {
  readonly "openai-codex"?: { readonly type: "oauth" } & OAuthCredentials;
}

interface RunRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
  readonly input: unknown;
  readonly context?: {
    readonly userId?: string;
  };
}

interface ContinueRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
}

interface CommandRequest {
  readonly sessionId: string;
  readonly content?: string;
}

interface GetEventsRequest {
  readonly sessionId: string;
  readonly offset?: number;
}

async function getUserInput(message: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(`${message}: `);
  } finally {
    rl.close();
  }
}

function loadAuth(): StoredAuth {
  if (!existsSync(AUTH_FILE_URL)) {
    return {};
  }

  const raw = readFileSync(AUTH_FILE_URL, "utf-8");
  return JSON.parse(raw) as StoredAuth;
}

function saveAuth(auth: StoredAuth): void {
  writeFileSync(AUTH_FILE_URL, JSON.stringify(auth, null, 2), "utf-8");
}

async function ensureOpenAICodexAccessToken(): Promise<string> {
  const current = loadAuth()["openai-codex"];
  if (current && current.expires > Date.now()) {
    return current.access;
  }

  const credentials = await loginOpenAICodex({
    onAuth: (info) => {
      console.log(`Open: ${info.url}`);
      if (info.instructions) console.log(info.instructions);
    },
    onPrompt: async (prompt) => getUserInput(prompt.message),
    onProgress: (message) => console.log(message),
  });

  const auth = { "openai-codex": { type: "oauth", ...credentials } } as const;
  saveAuth(auth);
  return credentials.access;
}

const openAIAccessToken = await ensureOpenAICodexAccessToken();
process.env.OPENAI_API_KEY = openAIAccessToken;

const agents = createExampleAgents(getModel("openai-codex", "gpt-5.3-codex"), {
  getApiKey: () => openAIAccessToken,
});
const restateContextStorage = new AsyncLocalStorage<restate.ObjectContext>();
const snapshotStateKey = "snapshot";

const contextStore: ContextStore<HarnessSessionSnapshot<typeof agents>> = {
  load: async () => {
    const ctx = restateContextStorage.getStore();
    if (!ctx) {
      return undefined;
    }

    return (await ctx.get<HarnessSessionSnapshot<typeof agents>>(snapshotStateKey)) ?? undefined;
  },
  save: async (_sessionId, state) => {
    const ctx = restateContextStorage.getStore();
    if (!ctx) {
      return;
    }

    ctx.set(snapshotStateKey, state);
  },
};

let internalApi: RestateApi<EventMap, undefined> | undefined;

const harness = createHarness({
  agents,
  contextStore,
  adapters: {
    createApi: ({ orchestrator }) => {
      const api = createRestateApi({ orchestrator });
      internalApi = api;
      return api;
    },
  },
});

function getInternalApi(): RestateApi<EventMap, undefined> {
  if (!internalApi) {
    throw new Error("Harness API not initialized");
  }

  return internalApi;
}

function isAgentKey(value: string): value is keyof typeof agents & string {
  return value in agents;
}

function getAgentKey(value: string): keyof typeof agents & string {
  if (!isAgentKey(value)) {
    throw new restate.TerminalError(`Unknown agent '${value}'`, { errorCode: 400 });
  }

  return value;
}

function resolveSessionId(ctx: restate.ObjectContext, requestSessionId: string): string {
  const keySessionId = String(ctx.key);
  if (requestSessionId !== keySessionId) {
    throw new restate.TerminalError(
      `Session id mismatch: request '${requestSessionId}' does not match key '${keySessionId}'`,
      { errorCode: 400 },
    );
  }

  return keySessionId;
}

const orchestratorService = restate.object({
  name: "agent-orchestrator",
  handlers: {
    run: async (ctx: restate.ObjectContext, request: RunRequest) => {
      const key = getAgentKey(request.agent);
      const agentDefinition = agents[key];
      if (typeof request.input !== "string") {
        throw new restate.TerminalError("Invalid run input payload", { errorCode: 400 });
      }

      const decodedInput = agentDefinition.input.decode(request.input);
      const sessionId = resolveSessionId(ctx, request.sessionId);
      const result = await restateContextStorage.run(ctx, async () =>
        harness.run(key, {
          sessionId,
          idempotencyKey: request.idempotencyKey,
          input: decodedInput,
          context: {
            userId: request.context?.userId ?? "demo-user",
          },
        }),
      );

      return harness.encodeRunResponse(key, result) as HarnessRunResponse<unknown>;
    },

    continue: async (ctx: restate.ObjectContext, request: ContinueRequest) => {
      const key = getAgentKey(request.agent);
      const sessionId = resolveSessionId(ctx, request.sessionId);
      const result = await restateContextStorage.run(ctx, async () =>
        harness.continue(key, {
          sessionId,
          idempotencyKey: request.idempotencyKey,
        }),
      );

      return harness.encodeRunResponse(key, result) as HarnessRunResponse<unknown>;
    },

    steer: async (ctx: restate.ObjectContext, request: CommandRequest) => {
      const sessionId = resolveSessionId(ctx, request.sessionId);
      await getInternalApi().steer(
        {
          sessionId: toSessionId(sessionId),
          content: request.content,
        },
        undefined,
      );

      return { ok: true };
    },

    followUp: async (ctx: restate.ObjectContext, request: CommandRequest) => {
      const sessionId = resolveSessionId(ctx, request.sessionId);
      await getInternalApi().followUp(
        {
          sessionId: toSessionId(sessionId),
          content: request.content,
        },
        undefined,
      );

      return { ok: true };
    },

    cancel: async (ctx: restate.ObjectContext, request: CommandRequest) => {
      const sessionId = resolveSessionId(ctx, request.sessionId);
      await getInternalApi().cancel(
        {
          sessionId: toSessionId(sessionId),
          content: request.content,
        },
        undefined,
      );

      return { ok: true };
    },

    getEvents: async (ctx: restate.ObjectContext, request: GetEventsRequest) => {
      const sessionId = resolveSessionId(ctx, request.sessionId);
      return getInternalApi().getEvents(
        {
          sessionId: toSessionId(sessionId),
          content: "events",
          offset: request.offset,
        },
        undefined,
      );
    },
  },
});

const port = Number(process.env.RESTATE_WORKER_PORT ?? "9080");
await restate.serve({
  services: [orchestratorService],
  port,
});
