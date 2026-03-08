import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { getModel, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai";
import { createPubsubObject } from "@restatedev/pubsub";
import { createPubsubClient } from "@restatedev/pubsub-client";
import * as restate from "@restatedev/restate-sdk";

import {
  activeTurnStateKey,
  createHarness,
  createPubsubBridge,
  createRestateApi,
  createRestateDurableRuntime,
  createRestateTurnRuntime,
  toSessionId,
  turnCancelSignalKey,
  turnControlSignalKey,
  type EventMap,
  type HarnessRunResponse,
  type HarnessSessionSnapshot,
  type RestateApi,
  type TurnControlCommand,
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
  readonly turnId?: string;
  readonly context?: {
    readonly userId?: string;
  };
}

interface ContinueRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
}

interface ResultRequest {
  readonly sessionId: string;
  readonly turnId: string;
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

const agents = createExampleAgents(getModel("openai-codex", "gpt-5.2"), {
  getApiKey: () => openAIAccessToken,
});
const snapshotStateKey = "snapshot";
const restateIngressUrl = (process.env.RESTATE_INGRESS_URL ?? "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const pubsubName = process.env.RESTATE_PUBSUB_NAME ?? "pubsub";
const pubsubClient = createPubsubClient({
  url: restateIngressUrl,
  name: pubsubName,
});

type HarnessForAgents = ReturnType<typeof createHarness<typeof agents>>;
const harnessCache = new Map<string, HarnessForAgents>();
const apiCache = new Map<string, RestateApi<EventMap, undefined>>();
const latestCtxCache = new Map<string, restate.ObjectContext>();

function getCachedInternalApi(sessionId: string): RestateApi<EventMap, undefined> | undefined {
  return apiCache.get(sessionId);
}

function getLatestCtx(sessionId: string): restate.ObjectContext {
  const ctx = latestCtxCache.get(sessionId);
  if (!ctx) {
    throw new restate.TerminalError("Session runtime is not initialized", { errorCode: 409 });
  }

  return ctx;
}

function getRequestHarness(
  ctx: restate.ObjectContext | restate.ObjectSharedContext,
  sessionId: string,
): {
  readonly harness: HarnessForAgents;
  readonly getInternalApi: () => RestateApi<EventMap, undefined>;
} {
  if ("set" in ctx) {
    latestCtxCache.set(sessionId, ctx as restate.ObjectContext);
  }

  const cachedHarness = harnessCache.get(sessionId);
  const cachedApi = apiCache.get(sessionId);
  if (cachedHarness && cachedApi) {
    return {
      harness: cachedHarness,
      getInternalApi: () => cachedApi,
    };
  }

  const pubsubBridge = createPubsubBridge({
    publisher: {
      publish: async (topic, envelope, idempotencyKey) => {
        await pubsubClient.publish(topic, envelope, idempotencyKey);
      },
    },
    topicForSession: (sessionId) => String(sessionId),
    idempotencyKeyForEvent: (envelope) =>
      `${String(envelope.sessionId)}:${String(envelope.turnId)}:${String(envelope.index)}:${String(envelope.type)}`,
  });

  let internalApi: RestateApi<EventMap, undefined> | undefined;

  const harness = createHarness({
    agents,
    contextStore: {
      load: async () =>
        (await getLatestCtx(sessionId).get<HarnessSessionSnapshot<typeof agents>>(
          snapshotStateKey,
        )) ?? undefined,
      save: async (_sessionId, state) => {
        getLatestCtx(sessionId).set(snapshotStateKey, state);
      },
    },
    adapters: {
      onPublish: (_sessionId, envelope) => {
        void pubsubBridge.publish(envelope).catch((error) => {
          console.error("Failed to publish envelope to pubsub", error);
        });
      },
      createApi: ({ orchestrator }) => {
        const api = createRestateApi({ orchestrator });
        internalApi = api;
        return api;
      },
      createTurnRuntime: ({ sessionApi }) =>
        createRestateTurnRuntime({
          sessionApi,
          context: undefined,
        }),
    },
  });

  if (!internalApi) {
    throw new Error("Harness API not initialized");
  }

  const initializedApi = internalApi;

  harnessCache.set(sessionId, harness);
  apiCache.set(sessionId, initializedApi);

  return {
    harness,
    getInternalApi: () => initializedApi,
  };
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

function resolveSessionId(
  ctx: restate.ObjectContext | restate.ObjectSharedContext,
  requestSessionId: string,
): string {
  const keySessionId = String(ctx.key);
  if (requestSessionId !== keySessionId) {
    throw new restate.TerminalError(
      `Session id mismatch: request '${requestSessionId}' does not match key '${keySessionId}'`,
      { errorCode: 400 },
    );
  }

  return keySessionId;
}

function dispatchRunInBackground(
  ctx: restate.ObjectContext,
  sessionId: string,
  request: RunRequest,
): void {
  try {
    const sender = ctx.objectSendClient<{
      readonly run: (_ctx: unknown, input: RunRequest) => void;
    }>({ name: "agent-orchestrator" }, sessionId);

    sender.run(
      request,
      restate.rpc.sendOpts({
        idempotencyKey: `${request.idempotencyKey}:run-dispatch`,
        name: "dispatch-background-run",
      }),
    );
  } catch (error) {
    throw new restate.TerminalError(
      `Failed to dispatch background run: ${error instanceof Error ? error.message : String(error)}`,
      { errorCode: 500 },
    );
  }
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

      const decodedInput = (() => {
        try {
          return agentDefinition.input.decode(request.input);
        } catch {
          throw new restate.TerminalError("Failed to decode run input payload", { errorCode: 400 });
        }
      })();

      const sessionId = resolveSessionId(ctx, request.sessionId);
      const { harness } = getRequestHarness(ctx, sessionId);
      const result = await harness.run(key, {
        sessionId,
        idempotencyKey: request.idempotencyKey,
        input: decodedInput,
        context: {
          userId: request.context?.userId ?? "demo-user",
        },
        turnId: request.turnId,
      });

      return harness.encodeRunResponse(key, result) as HarnessRunResponse<unknown>;
    },

    submit: async (ctx: restate.ObjectContext, request: RunRequest) => {
      const key = getAgentKey(request.agent);
      const agentDefinition = agents[key];
      if (typeof request.input !== "string") {
        throw new restate.TerminalError("Invalid submit input payload", { errorCode: 400 });
      }

      (() => {
        try {
          agentDefinition.input.decode(request.input);
        } catch {
          throw new restate.TerminalError("Failed to decode submit input payload", {
            errorCode: 400,
          });
        }
      })();

      const sessionId = resolveSessionId(ctx, request.sessionId);
      const turnId = request.turnId ?? `turn-submit-${request.idempotencyKey}`;

      dispatchRunInBackground(ctx, sessionId, {
        ...request,
        sessionId,
        turnId,
      });

      return {
        turnId,
      };
    },

    result: async (ctx: restate.ObjectContext, request: ResultRequest) => {
      const key = getAgentKey(request.agent);
      const sessionId = resolveSessionId(ctx, request.sessionId);
      const { harness } = getRequestHarness(ctx, sessionId);
      const result = await harness.result(key, {
        sessionId,
        turnId: request.turnId,
      });

      return harness.encodeRunResponse(key, result) as HarnessRunResponse<unknown>;
    },

    continue: async (ctx: restate.ObjectContext, request: ContinueRequest) => {
      const key = getAgentKey(request.agent);
      const sessionId = resolveSessionId(ctx, request.sessionId);
      const { harness } = getRequestHarness(ctx, sessionId);
      const result = await harness.continue(key, {
        sessionId,
        idempotencyKey: request.idempotencyKey,
      });

      return harness.encodeRunResponse(key, result) as HarnessRunResponse<unknown>;
    },

    steer: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext, request: CommandRequest) => {
        const sessionId = resolveSessionId(ctx, request.sessionId);
        const activeTurnId = await ctx.get<string>(activeTurnStateKey(sessionId));
        if (activeTurnId) {
          const runtime = createRestateDurableRuntime(ctx, {
            state: {
              get: async <T>(key: string) => (await ctx.get<T>(key)) ?? undefined,
            },
          });
          await runtime.signals
            .forKey<TurnControlCommand>(turnControlSignalKey(sessionId, activeTurnId))
            .resolve({ type: "steer", content: request.content ?? "" });
        } else {
          const internalApi = getCachedInternalApi(sessionId);
          if (!internalApi) {
            return { ok: false };
          }

          await internalApi.steer(
            {
              sessionId: toSessionId(sessionId),
              content: request.content,
            },
            undefined,
          );
        }

        return { ok: true };
      },
    ),

    followUp: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext, request: CommandRequest) => {
        const sessionId = resolveSessionId(ctx, request.sessionId);
        const activeTurnId = await ctx.get<string>(activeTurnStateKey(sessionId));
        if (activeTurnId) {
          const runtime = createRestateDurableRuntime(ctx, {
            state: {
              get: async <T>(key: string) => (await ctx.get<T>(key)) ?? undefined,
            },
          });
          await runtime.signals
            .forKey<TurnControlCommand>(turnControlSignalKey(sessionId, activeTurnId))
            .resolve({ type: "follow_up", content: request.content ?? "" });
        } else {
          const internalApi = getCachedInternalApi(sessionId);
          if (!internalApi) {
            return { ok: false };
          }

          await internalApi.followUp(
            {
              sessionId: toSessionId(sessionId),
              content: request.content,
            },
            undefined,
          );
        }

        return { ok: true };
      },
    ),

    cancel: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext, request: CommandRequest) => {
        const sessionId = resolveSessionId(ctx, request.sessionId);
        const activeTurnId = await ctx.get<string>(activeTurnStateKey(sessionId));
        if (activeTurnId) {
          const runtime = createRestateDurableRuntime(ctx, {
            state: {
              get: async <T>(key: string) => (await ctx.get<T>(key)) ?? undefined,
            },
          });
          await runtime.signals
            .forKey<string>(turnCancelSignalKey(sessionId, activeTurnId))
            .resolve(request.content ?? "Cancelled by user");
        }

        const internalApi = getCachedInternalApi(sessionId);
        if (internalApi) {
          await internalApi.cancel(
            {
              sessionId: toSessionId(sessionId),
              content: request.content,
            },
            undefined,
          );
        }

        return { ok: true };
      },
    ),

    getEvents: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext, request: GetEventsRequest) => {
        const sessionId = resolveSessionId(ctx, request.sessionId);
        const internalApi = getCachedInternalApi(sessionId);
        if (!internalApi) {
          return [];
        }

        return internalApi.getEvents(
          {
            sessionId: toSessionId(sessionId),
            content: "events",
            offset: request.offset,
          },
          undefined,
        );
      },
    ),
  },
});

const port = Number(process.env.RESTATE_WORKER_PORT ?? "9080");
const pubsubObject = createPubsubObject(pubsubName, {});
await restate.serve({
  services: [orchestratorService, pubsubObject],
  port,
});
