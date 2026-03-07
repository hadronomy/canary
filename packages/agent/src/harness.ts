import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentState,
  type AgentTool,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Model, ThinkingBudgets, Transport } from "@mariozechner/pi-ai";

import { createFetchHarnessAdapter } from "~/adapters/fetch";
import type {
  CreateFetchHarnessAdapterOptions,
  HarnessClientAdapter,
  HarnessClientRoutes,
  HarnessEventSourceFactory,
  HarnessFetch,
  HarnessFetchOptions,
  WireEventEnvelope,
} from "~/adapters/types";
import { createSessionApi, type SessionApi } from "~/api";
import type { Codec } from "~/codec";
import { codec } from "~/codec";
import { TURN_ERROR_CODE, TURN_ERROR_STAGE } from "~/errors";
import { createSessionOrchestrator, type SessionOrchestrator } from "~/orchestrator";
import {
  defineEventRegistryFromMap,
  toEventIndex,
  toIdempotencyKey,
  toTurnId,
  toSessionId,
  type AnyEventEnvelope,
  type EventMap,
  type EventRegistry,
  type SessionCommandInput,
  type SessionMutationResult,
  type SessionSnapshot,
  type SubmitTurnInput,
  type SubmitTurnResult,
  type TurnId,
} from "~/protocol";
import type { Runtime } from "~/runtime";
import { createSseServer } from "~/stream";
import { createEventFlow, createPiEventMapper, mapAgentEventToPiEvent } from "~/workflow";

import type { MakeExclusive } from "./types";

export interface HarnessAgentConfig {
  readonly systemPrompt: string;
  readonly model: Model<any>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly tools?: ReadonlyArray<AgentTool<any>>;
  readonly messages?: ReadonlyArray<AgentMessage>;
  readonly convertToLlm?: AgentOptions["convertToLlm"];
  readonly transformContext?: AgentOptions["transformContext"];
  readonly steeringMode?: AgentOptions["steeringMode"];
  readonly followUpMode?: AgentOptions["followUpMode"];
  readonly streamFn?: AgentOptions["streamFn"];
  readonly sessionId?: string;
  readonly getApiKey?: AgentOptions["getApiKey"];
  readonly thinkingBudgets?: ThinkingBudgets;
  readonly transport?: Transport;
  readonly maxRetryDelayMs?: number;
}

export type HarnessAgentDefinition<
  TInput,
  TOutput,
  TContext = unknown,
  TInputWire = unknown,
  TOutputWire = unknown,
> = {
  readonly config: HarnessAgentConfig;
  readonly input: Codec<TInput, TInputWire>;
  readonly output: Codec<TOutput, TOutputWire>;
  readonly prompt?: (
    input: TInput,
    context: TContext,
  ) => string | AgentMessage | ReadonlyArray<AgentMessage>;
  readonly resolveOutput: (args: {
    readonly input: TInput;
    readonly context: TContext;
    readonly state: AgentState;
    readonly text: string;
  }) => Promise<TOutput> | TOutput;
};

export type HarnessAgents = Record<string, HarnessAgentDefinition<any, any, any, any, any>>;

export type HarnessAgentInput<TAgent extends HarnessAgentDefinition<any, any, any, any, any>> =
  TAgent extends HarnessAgentDefinition<infer TInput, any, any, any, any> ? TInput : never;

export type HarnessAgentOutput<TAgent extends HarnessAgentDefinition<any, any, any, any, any>> =
  TAgent extends HarnessAgentDefinition<any, infer TOutput, any, any, any> ? TOutput : never;

export type HarnessAgentContext<TAgent extends HarnessAgentDefinition<any, any, any, any, any>> =
  TAgent extends HarnessAgentDefinition<any, any, infer TContext, any, any> ? TContext : never;

export type HarnessAgentInputWire<TAgent extends HarnessAgentDefinition<any, any, any, any, any>> =
  TAgent extends HarnessAgentDefinition<any, any, any, infer TInputWire, any> ? TInputWire : never;

export type HarnessAgentOutputWire<TAgent extends HarnessAgentDefinition<any, any, any, any, any>> =
  TAgent extends HarnessAgentDefinition<any, any, any, any, infer TOutputWire>
    ? TOutputWire
    : never;

export type HarnessSessionSnapshot<TAgents extends HarnessAgents> = {
  [K in keyof TAgents & string]: {
    readonly agent: K;
    readonly inputWire: HarnessAgentInputWire<TAgents[K]>;
    readonly context: HarnessAgentContext<TAgents[K]>;
    readonly agentState: AgentState;
    readonly completedRuns?: Readonly<
      Record<
        string,
        {
          readonly outputWire: HarnessAgentOutputWire<TAgents[K]>;
          readonly nextIndex: number;
        }
      >
    >;
  };
}[keyof TAgents & string];

type StoredRunResult<TAgents extends HarnessAgents> = {
  [K in keyof TAgents & string]: {
    readonly agent: K;
    readonly outputWire: HarnessAgentOutputWire<TAgents[K]>;
    readonly nextIndex: number;
  };
}[keyof TAgents & string];

export interface PublicHarnessAgentContract<TInput, TOutput> {
  readonly input: Codec<TInput, unknown>;
  readonly output: Codec<TOutput, unknown>;
}

export type PublicHarnessAgentContracts<TAgents extends HarnessAgents> = {
  [K in keyof TAgents]: PublicHarnessAgentContract<
    HarnessAgentInput<TAgents[K]>,
    HarnessAgentOutput<TAgents[K]>
  >;
};

export function defineAgent<
  TInput,
  TOutput,
  TContext = unknown,
  TInputWire = unknown,
  TOutputWire = unknown,
>(
  definition: HarnessAgentDefinition<TInput, TOutput, TContext, TInputWire, TOutputWire>,
): HarnessAgentDefinition<TInput, TOutput, TContext, TInputWire, TOutputWire> {
  return definition;
}

export function defineAgents<TAgents extends HarnessAgents>(agents: TAgents): TAgents {
  return agents;
}

export function toPublicAgentContract<TInput, TOutput, TContext = unknown>(
  agent: HarnessAgentDefinition<TInput, TOutput, TContext, unknown, unknown>,
): PublicHarnessAgentContract<TInput, TOutput> {
  return {
    input: agent.input,
    output: agent.output,
  };
}

export function toPublicAgentContracts<TAgents extends HarnessAgents>(
  agents: TAgents,
): PublicHarnessAgentContracts<TAgents> {
  const result = {} as PublicHarnessAgentContracts<TAgents>;

  for (const key of Object.keys(agents) as Array<keyof TAgents>) {
    const agent = agents[key]!;
    result[key] = {
      input: agent.input,
      output: agent.output,
    } as PublicHarnessAgentContracts<TAgents>[typeof key];
  }

  return result;
}

interface HarnessSessionState {
  readonly events: Array<AnyEventEnvelope<EventMap>>;
  readonly listeners: Set<(chunk: string) => void>;
  nextIndex: number;
  activeAgent?: Agent;
  abortController?: AbortController;
}

export interface ContextStore<TState = unknown> {
  readonly load: (sessionId: string) => Promise<TState | undefined>;
  readonly save: (sessionId: string, state: TState) => Promise<void>;
}

export interface HarnessRunOptions<TInput, TContext> {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly input: TInput;
  readonly context: TContext;
  readonly turnId?: string;
}

export interface HarnessSubmitOptions<TInput, TContext> {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly input: TInput;
  readonly context: TContext;
}

export interface HarnessResultOptions {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface HarnessSubmitResult {
  readonly turnId: TurnId;
}

export interface HarnessRunResult<TOutput> {
  readonly output: TOutput;
  readonly turnId: TurnId;
  readonly nextIndex: number;
}

export interface HarnessRunResponse<TOutputWire> {
  readonly output: TOutputWire;
  readonly turnId: string;
  readonly nextIndex: number;
}

export interface HarnessAdapters {
  readonly topicForSession?: (sessionId: string) => string;
  readonly onPublish?: (sessionId: string, envelope: AnyEventEnvelope<EventMap>) => void;
  readonly createOrchestrator?: (options: {
    readonly runtime: Runtime<unknown, unknown, unknown, unknown, unknown>;
    readonly pubsub: {
      readonly publish: (sessionId: string, envelope: AnyEventEnvelope<EventMap>) => void;
    };
    readonly topicForSession: (sessionId: string) => string;
    readonly handlers: SessionOrchestrator<EventMap, undefined>;
  }) => SessionOrchestrator<EventMap, undefined>;
  readonly createApi?: (options: {
    readonly orchestrator: SessionOrchestrator<EventMap, undefined>;
  }) => SessionApi<EventMap, undefined>;
  readonly createTurnRuntime?: (options: {
    readonly execute: (input: SubmitTurnInput) => Promise<SubmitTurnResult>;
    readonly sessionApi: SessionApi<EventMap, undefined>;
  }) => HarnessTurnRuntime;
}

export interface HarnessTurnRuntime {
  readonly submitTurn: (input: SubmitTurnInput) => Promise<SubmitTurnResult>;
}

export function createInMemoryHarnessTurnRuntime(
  execute: (input: SubmitTurnInput) => Promise<SubmitTurnResult>,
): HarnessTurnRuntime {
  const turnByIdempotency = new Map<string, Promise<SubmitTurnResult>>();

  return {
    async submitTurn(input: SubmitTurnInput): Promise<SubmitTurnResult> {
      const dedupeKey = `${String(input.sessionId)}:${String(input.idempotencyKey)}`;
      const existing = turnByIdempotency.get(dedupeKey);
      if (existing) {
        return existing;
      }

      const pending = execute(input).catch((error) => {
        turnByIdempotency.delete(dedupeKey);
        throw error;
      });

      turnByIdempotency.set(dedupeKey, pending);
      return pending;
    },
  };
}

export interface CreateHarnessOptions<TAgents extends HarnessAgents> {
  readonly agents: TAgents;
  readonly eventRegistry?: EventRegistry<EventMap>;
  readonly transport?: Transport;
  readonly adapters?: HarnessAdapters;
  readonly contextStore?: ContextStore<HarnessSessionSnapshot<TAgents>>;
}

export function createHarness<TAgents extends HarnessAgents>(
  options: CreateHarnessOptions<TAgents>,
) {
  const eventRegistry =
    options.eventRegistry ??
    defineEventRegistryFromMap({
      defaultCodec: codec.superJson,
    });

  const sessions = new Map<string, HarnessSessionState>();
  const runResults = new Map<string, StoredRunResult<TAgents>>();
  const sessionSnapshots = new Map<string, HarnessSessionSnapshot<TAgents>>();
  const sse = createSseServer({ eventRegistry });

  type SubmitMetadata = {
    readonly agent: keyof TAgents & string;
    readonly intent?: "run" | "continue";
    readonly input?: unknown;
    readonly context?: unknown;
    readonly turnId?: string;
  };

  function runResultKey(sessionId: string, turnId: TurnId): string {
    return `${sessionId}:${String(turnId)}`;
  }

  function settleRunResult(key: string, stored: StoredRunResult<TAgents>): void {
    runResults.set(key, stored);
  }

  async function loadStoredRunResultFromSnapshot(
    sessionId: string,
    turnId: TurnId,
  ): Promise<StoredRunResult<TAgents> | undefined> {
    const snapshot = await loadSessionSnapshot(sessionId, { refresh: true });
    if (!snapshot) {
      return undefined;
    }

    const completedRuns = snapshot.completedRuns as
      | Readonly<Record<string, { readonly outputWire: unknown; readonly nextIndex: number }>>
      | undefined;
    const completed = completedRuns?.[String(turnId)];

    if (!completed) {
      return undefined;
    }

    return {
      agent: snapshot.agent,
      outputWire: completed.outputWire,
      nextIndex: completed.nextIndex,
    } as StoredRunResult<TAgents>;
  }

  async function waitForStoredRunResult(
    sessionId: string,
    turnId: TurnId,
  ): Promise<StoredRunResult<TAgents>> {
    const key = runResultKey(sessionId, turnId);

    const existing = runResults.get(key);
    if (existing) {
      return existing;
    }

    while (true) {
      const fromSnapshot = await loadStoredRunResultFromSnapshot(sessionId, turnId);
      if (fromSnapshot) {
        runResults.set(key, fromSnapshot);
        return fromSnapshot;
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  function snapshotForAgent<TKey extends keyof TAgents & string>(
    snapshot: HarnessSessionSnapshot<TAgents> | undefined,
    key: TKey,
  ): Extract<HarnessSessionSnapshot<TAgents>, { readonly agent: TKey }> | undefined {
    if (!snapshot || snapshot.agent !== key) {
      return undefined;
    }

    return snapshot as Extract<HarnessSessionSnapshot<TAgents>, { readonly agent: TKey }>;
  }

  function storedResultForAgent<TKey extends keyof TAgents & string>(
    stored: StoredRunResult<TAgents>,
    key: TKey,
  ): Extract<StoredRunResult<TAgents>, { readonly agent: TKey }> {
    if (stored.agent !== key) {
      throw new TypeError(`Stored run result agent '${stored.agent}' does not match '${key}'`);
    }

    return stored as Extract<StoredRunResult<TAgents>, { readonly agent: TKey }>;
  }

  function getAgentDefinition<TKey extends keyof TAgents & string>(key: TKey): TAgents[TKey] {
    const agent = options.agents[key];
    if (!agent) {
      throw new TypeError(`Unknown agent '${key}'`);
    }

    return agent;
  }

  function getSession(sessionId: string): HarnessSessionState {
    const existing = sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: HarnessSessionState = {
      events: [],
      listeners: new Set<(chunk: string) => void>(),
      nextIndex: 0,
    };

    sessions.set(sessionId, created);
    return created;
  }

  function publish(sessionId: string, envelope: AnyEventEnvelope<EventMap>): void {
    const session = getSession(sessionId);
    session.events.push(envelope);
    session.nextIndex = Math.max(session.nextIndex, Number(envelope.index) + 1);
    options.adapters?.onPublish?.(sessionId, envelope);

    const sessionStream = sse.session(toSessionId(sessionId));
    const chunk = sessionStream.event(envelope.type, envelope.payload, {
      index: envelope.index,
      turnId: envelope.turnId,
    });

    for (const listener of session.listeners) {
      listener(chunk);
    }
  }

  async function loadSessionSnapshot(
    sessionId: string,
    loadOptions?: {
      readonly refresh?: boolean;
    },
  ): Promise<HarnessSessionSnapshot<TAgents> | undefined> {
    const cached = sessionSnapshots.get(sessionId);
    if (cached && !loadOptions?.refresh) {
      return cached;
    }

    const stored = await options.contextStore?.load(sessionId);
    if (stored) {
      sessionSnapshots.set(sessionId, stored);
    }

    return stored;
  }

  async function saveSessionSnapshot(
    sessionId: string,
    snapshot: HarnessSessionSnapshot<TAgents>,
  ): Promise<void> {
    sessionSnapshots.set(sessionId, snapshot);
    await options.contextStore?.save(sessionId, snapshot);
  }

  async function runInternal<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly idempotencyKey: string;
      readonly intent: "run" | "continue";
      readonly input?: HarnessAgentInput<TAgents[TKey]>;
      readonly context?: HarnessAgentContext<TAgents[TKey]>;
      readonly turnId?: TurnId;
    },
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);
    const persistedSnapshot = snapshotForAgent(
      await loadSessionSnapshot(runOptions.sessionId),
      key,
    );

    let input: HarnessAgentInput<TAgents[TKey]>;
    let context: HarnessAgentContext<TAgents[TKey]>;
    let rehydratedState: AgentState | undefined;

    if (runOptions.intent === "continue") {
      if (!persistedSnapshot) {
        throw new TypeError(`No persisted state found for continue on agent '${key}'`);
      }

      input = agentDefinition.input.decode(
        persistedSnapshot.inputWire as HarnessAgentInputWire<TAgents[TKey]>,
      ) as HarnessAgentInput<TAgents[TKey]>;
      context = persistedSnapshot.context;
      rehydratedState = persistedSnapshot.agentState;
    } else {
      if (runOptions.input === undefined || runOptions.context === undefined) {
        throw new TypeError("run intent requires both input and context");
      }

      input = runOptions.input;
      context = runOptions.context;

      if (persistedSnapshot) {
        rehydratedState = persistedSnapshot.agentState;
      }
    }

    const session = getSession(runOptions.sessionId);
    const flow = createEventFlow<EventMap>({
      sessionId: runOptions.sessionId,
      startIndex: session.nextIndex,
    });

    const turnId = flow.beginTurn(runOptions.turnId);
    const userMessageId = flow.ids.message("user");
    const assistantMessageId = flow.setAssistantMessageId();

    publish(runOptions.sessionId, flow.emit("turn_queued", { turnId }));
    publish(runOptions.sessionId, flow.emit("turn_started", { turnId }));

    const promptMessage =
      runOptions.intent === "run"
        ? agentDefinition.prompt
          ? agentDefinition.prompt(input, context)
          : JSON.stringify(agentDefinition.input.encode(input))
        : undefined;

    const promptText =
      promptMessage === undefined
        ? ""
        : typeof promptMessage === "string"
          ? promptMessage
          : Array.isArray(promptMessage)
            ? promptMessage.map((message) => JSON.stringify(message)).join("\n")
            : JSON.stringify(promptMessage);

    if (runOptions.intent === "run") {
      publish(
        runOptions.sessionId,
        flow.emit("user_message", {
          turnId,
          messageId: userMessageId,
          content: promptText,
        }),
      );
    }
    publish(
      runOptions.sessionId,
      flow.emit("assistant_message_start", {
        turnId,
        messageId: assistantMessageId,
      }),
    );

    const piAgent = new Agent({
      initialState: rehydratedState ?? {
        systemPrompt: agentDefinition.config.systemPrompt,
        model: agentDefinition.config.model,
        thinkingLevel: agentDefinition.config.thinkingLevel,
        tools: [...(agentDefinition.config.tools ?? [])],
        messages: [...(agentDefinition.config.messages ?? [])],
      },
      convertToLlm: agentDefinition.config.convertToLlm,
      transformContext: agentDefinition.config.transformContext,
      steeringMode: agentDefinition.config.steeringMode,
      followUpMode: agentDefinition.config.followUpMode,
      streamFn: agentDefinition.config.streamFn,
      sessionId: agentDefinition.config.sessionId ?? runOptions.sessionId,
      getApiKey: agentDefinition.config.getApiKey,
      thinkingBudgets: agentDefinition.config.thinkingBudgets,
      transport: agentDefinition.config.transport ?? options.transport,
      maxRetryDelayMs: agentDefinition.config.maxRetryDelayMs,
    });

    const mapPiEvent = createPiEventMapper({
      flow,
      turnId,
      assistantMessageId,
    });

    let generatedText = "";
    session.abortController = new AbortController();
    session.activeAgent = piAgent;
    const onAbort = () => {
      piAgent.abort();
    };
    session.abortController.signal.addEventListener("abort", onAbort, { once: true });

    const unsubscribe = piAgent.subscribe((event) => {
      const piEvent = mapAgentEventToPiEvent(event);
      if (!piEvent) {
        return;
      }

      const mapped = mapPiEvent(piEvent);
      for (const envelope of mapped) {
        publish(runOptions.sessionId, envelope);

        if (envelope.type === "assistant_text_delta") {
          generatedText += envelope.payload.delta;
        }
      }
    });

    try {
      if (runOptions.intent === "continue") {
        await piAgent.continue();
      } else {
        await piAgent.prompt(promptText);
      }

      publish(
        runOptions.sessionId,
        flow.emit("assistant_message_done", {
          turnId,
          messageId: assistantMessageId,
          stopReason: "stop",
        }),
      );
      publish(runOptions.sessionId, flow.emit("turn_done", { turnId }));
    } catch (error) {
      if (session.abortController?.signal.aborted) {
        const reason =
          typeof session.abortController.signal.reason === "string"
            ? session.abortController.signal.reason
            : "Cancelled by user";
        publish(runOptions.sessionId, flow.emit("turn_cancelled", { turnId, reason }));
      } else {
        publish(
          runOptions.sessionId,
          flow.emit("turn_error", {
            turnId,
            stage: TURN_ERROR_STAGE.LLM,
            retrying: false,
            code: TURN_ERROR_CODE.HARNESS_RUN_ERROR,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      throw error;
    } finally {
      unsubscribe();
      session.abortController?.signal.removeEventListener("abort", onAbort);
      session.activeAgent = undefined;
      session.abortController = undefined;
    }

    const output = await agentDefinition.resolveOutput({
      input,
      context,
      state: piAgent.state,
      text: generatedText,
    });

    const outputWire = agentDefinition.output.encode(output) as HarnessAgentOutputWire<
      TAgents[TKey]
    >;
    const persistedCompletedRuns =
      persistedSnapshot?.completedRuns ??
      ({} as Readonly<
        Record<
          string,
          {
            readonly outputWire: HarnessAgentOutputWire<TAgents[TKey]>;
            readonly nextIndex: number;
          }
        >
      >);
    const nextIndex = Number(flow.nextIndex());

    await saveSessionSnapshot(runOptions.sessionId, {
      agent: key,
      inputWire: agentDefinition.input.encode(input) as HarnessAgentInputWire<TAgents[TKey]>,
      context,
      agentState: piAgent.state,
      completedRuns: {
        ...persistedCompletedRuns,
        [String(turnId)]: {
          outputWire,
          nextIndex,
        },
      },
    });

    return {
      output: output as HarnessAgentOutput<TAgents[TKey]>,
      turnId,
      nextIndex,
    };
  }

  async function runViaSubmitForAgent<TKey extends keyof TAgents & string>(
    key: TKey,
    metadata: SubmitMetadata,
    input: SubmitTurnInput,
  ): Promise<SubmitTurnResult> {
    const agentDefinition = getAgentDefinition(key);
    const result =
      metadata.intent === "continue"
        ? await runInternal(key, {
            sessionId: String(input.sessionId),
            idempotencyKey: String(input.idempotencyKey),
            intent: "continue",
          })
        : await runInternal(key, {
            sessionId: String(input.sessionId),
            idempotencyKey: String(input.idempotencyKey),
            intent: "run",
            input: agentDefinition.input.decode(
              metadata.input as HarnessAgentInputWire<TAgents[TKey]>,
            ) as HarnessAgentInput<TAgents[TKey]>,
            context: metadata.context as HarnessAgentContext<TAgents[TKey]>,
            turnId: metadata.turnId ? toTurnId(metadata.turnId) : undefined,
          });

    settleRunResult(runResultKey(String(input.sessionId), result.turnId), {
      agent: key,
      outputWire: agentDefinition.output.encode(result.output) as HarnessAgentOutputWire<
        TAgents[TKey]
      >,
      nextIndex: result.nextIndex,
    });

    return { turnId: result.turnId };
  }

  async function runViaSubmit(input: SubmitTurnInput): Promise<SubmitTurnResult> {
    const metadata = input.metadata as SubmitMetadata | undefined;
    if (!metadata) {
      throw new TypeError("submitTurn metadata is required");
    }

    return runViaSubmitForAgent(metadata.agent, metadata, input);
  }

  function toControlMessage(content: string): AgentMessage {
    return {
      role: "user",
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    };
  }

  async function appendControlMessageToSnapshot(sessionId: string, content: string): Promise<void> {
    const snapshot = await loadSessionSnapshot(sessionId);
    if (!snapshot) {
      return;
    }

    await saveSessionSnapshot(sessionId, {
      ...snapshot,
      agentState: {
        ...snapshot.agentState,
        messages: [...snapshot.agentState.messages, toControlMessage(content)],
      },
    });
  }

  const orchestrationRuntime: Runtime<unknown, unknown, unknown, unknown, unknown> = {
    model: codec.superJson,
    tools: [],
    convertToLlm: (value: unknown) => value,
    transport: "sse",
  };

  const orchestrationHandlers: SessionOrchestrator<EventMap, undefined> = {
    createSession: async (): Promise<SessionMutationResult> => ({ ok: true }),
    submitTurn: async (input: SubmitTurnInput): Promise<SubmitTurnResult> => runViaSubmit(input),
    steer: async (input: SessionCommandInput): Promise<SessionMutationResult> => {
      const session = getSession(String(input.sessionId));
      if (input.content) {
        if (session.activeAgent) {
          session.activeAgent.steer(toControlMessage(input.content));
        } else {
          await appendControlMessageToSnapshot(String(input.sessionId), input.content);
        }
      }

      return { ok: true };
    },
    followUp: async (input: SessionCommandInput): Promise<SessionMutationResult> => {
      const session = getSession(String(input.sessionId));
      if (input.content) {
        if (session.activeAgent) {
          session.activeAgent.followUp(toControlMessage(input.content));
        } else {
          await appendControlMessageToSnapshot(String(input.sessionId), input.content);
        }
      }

      return { ok: true };
    },
    cancel: async (input: SessionCommandInput): Promise<SessionMutationResult> => {
      const session = getSession(String(input.sessionId));
      session.abortController?.abort(input.content ?? "Cancelled by user");
      session.activeAgent?.abort();
      return { ok: true };
    },
    closeSession: async (_input: SessionCommandInput): Promise<SessionMutationResult> => ({
      ok: true,
    }),
    getSnapshot: async (input: SessionCommandInput): Promise<SessionSnapshot<EventMap>> => {
      const session = getSession(String(input.sessionId));
      const lastEvent = session.events[session.events.length - 1];
      return {
        sessionId: toSessionId(String(input.sessionId)),
        status: "open",
        activeTurnId: lastEvent?.turnId ?? null,
        lastIndex: lastEvent?.index ?? toEventIndex(0),
        events: session.events,
      };
    },
    getEvents: async (input: SessionCommandInput & { readonly offset?: number }) => {
      const session = getSession(String(input.sessionId));
      const offset = input.offset ?? 0;
      return session.events.filter((event) => Number(event.index) >= offset);
    },
  };

  const topicForSession = options.adapters?.topicForSession ?? ((sessionId: string) => sessionId);
  const pubsub = { publish };

  const orchestrator =
    options.adapters?.createOrchestrator?.({
      runtime: orchestrationRuntime,
      pubsub,
      topicForSession,
      handlers: orchestrationHandlers,
    }) ??
    createSessionOrchestrator({
      runtime: orchestrationRuntime,
      pubsub,
      topicForSession,
      handlers: orchestrationHandlers,
    });

  const sessionApi =
    options.adapters?.createApi?.({ orchestrator }) ?? createSessionApi({ orchestrator });

  const turnRuntime =
    options.adapters?.createTurnRuntime?.({ execute: runViaSubmit, sessionApi }) ??
    createInMemoryHarnessTurnRuntime((input) => sessionApi.submitTurn(input, undefined));

  async function run<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: HarnessRunOptions<
      HarnessAgentInput<TAgents[TKey]>,
      HarnessAgentContext<TAgents[TKey]>
    >,
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);
    const submit = await turnRuntime.submitTurn({
      sessionId: toSessionId(runOptions.sessionId),
      idempotencyKey: toIdempotencyKey(runOptions.idempotencyKey),
      content: "harness.run",
      metadata: {
        agent: key,
        intent: "run",
        input: agentDefinition.input.encode(runOptions.input),
        context: runOptions.context,
        turnId: runOptions.turnId,
      },
    });

    const stored = await waitForStoredRunResult(runOptions.sessionId, submit.turnId);

    const narrowed = storedResultForAgent(stored, key);

    return {
      output: agentDefinition.output.decode(narrowed.outputWire) as HarnessAgentOutput<
        TAgents[TKey]
      >,
      turnId: submit.turnId,
      nextIndex: narrowed.nextIndex,
    };
  }

  async function continueRun<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly idempotencyKey: string;
    },
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);
    const submit = await turnRuntime.submitTurn({
      sessionId: toSessionId(runOptions.sessionId),
      idempotencyKey: toIdempotencyKey(runOptions.idempotencyKey),
      content: "harness.continue",
      metadata: {
        agent: key,
        intent: "continue",
      },
    });

    const stored = await waitForStoredRunResult(runOptions.sessionId, submit.turnId);

    const narrowed = storedResultForAgent(stored, key);

    return {
      output: agentDefinition.output.decode(narrowed.outputWire) as HarnessAgentOutput<
        TAgents[TKey]
      >,
      turnId: submit.turnId,
      nextIndex: narrowed.nextIndex,
    };
  }

  async function submit<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: HarnessSubmitOptions<
      HarnessAgentInput<TAgents[TKey]>,
      HarnessAgentContext<TAgents[TKey]>
    >,
  ): Promise<HarnessSubmitResult> {
    const agentDefinition = getAgentDefinition(key);
    const submitResult = await turnRuntime.submitTurn({
      sessionId: toSessionId(runOptions.sessionId),
      idempotencyKey: toIdempotencyKey(runOptions.idempotencyKey),
      content: "harness.submit",
      metadata: {
        agent: key,
        intent: "run",
        input: agentDefinition.input.encode(runOptions.input),
        context: runOptions.context,
      },
    });

    return {
      turnId: submitResult.turnId,
    };
  }

  async function result<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: HarnessResultOptions,
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);
    const turnId = toTurnId(runOptions.turnId);
    const stored = await waitForStoredRunResult(runOptions.sessionId, turnId);
    const narrowed = storedResultForAgent(stored, key);

    return {
      output: agentDefinition.output.decode(narrowed.outputWire) as HarnessAgentOutput<
        TAgents[TKey]
      >,
      turnId,
      nextIndex: narrowed.nextIndex,
    };
  }

  function eventsStream(streamOptions: {
    readonly sessionId: string;
    readonly offset?: number;
    readonly signal?: AbortSignal;
  }): ReadableStream<Uint8Array> {
    const session = getSession(streamOptions.sessionId);
    const offset = streamOptions.offset ?? 0;
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
      start(controller) {
        const sessionStream = sse.session(streamOptions.sessionId);
        controller.enqueue(encoder.encode(sessionStream.comment("connected")));

        let nextReplayIndex = offset;

        const emitEvent = (event: AnyEventEnvelope<EventMap>): void => {
          if (Number(event.index) < nextReplayIndex) {
            return;
          }

          controller.enqueue(
            encoder.encode(
              sessionStream.event(event.type, event.payload, {
                index: event.index,
                turnId: event.turnId,
              }),
            ),
          );

          nextReplayIndex = Number(event.index) + 1;
        };

        const replayUpperBound = session.nextIndex;
        for (const event of session.events) {
          if (Number(event.index) >= replayUpperBound) {
            break;
          }

          emitEvent(event);
        }

        const gapReplayStart = session.nextIndex;

        const listener = (chunk: string) => {
          controller.enqueue(encoder.encode(chunk));
        };

        session.listeners.add(listener);

        for (const event of session.events) {
          const index = Number(event.index);
          if (index < gapReplayStart) {
            continue;
          }

          if (index >= session.nextIndex) {
            break;
          }

          emitEvent(event);
        }

        const cleanup = () => {
          session.listeners.delete(listener);
          controller.close();
        };

        streamOptions.signal?.addEventListener("abort", cleanup);
      },
    });
  }

  return {
    agents: options.agents,
    eventRegistry,
    run,
    submit,
    result,
    continue: continueRun,
    eventsStream,
    encodeRunResponse<TKey extends keyof TAgents & string>(
      key: TKey,
      result: HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>,
    ): HarnessRunResponse<HarnessAgentOutputWire<TAgents[TKey]>> {
      const agent = getAgentDefinition(key);
      return {
        // TODO(agent-harness): remove cast via a typed response envelope codec keyed by agent.
        output: agent.output.encode(result.output) as HarnessAgentOutputWire<TAgents[TKey]>,
        turnId: String(result.turnId),
        nextIndex: result.nextIndex,
      };
    },
  };
}

type HarnessClientSharedOptions<TAgents extends HarnessClientAgents> = {
  readonly agents: TAgents;
  readonly queryParams?: Record<string, string>;
  readonly fetch?: HarnessFetch;
  readonly fetchOptions?: () => HarnessFetchOptions | Promise<HarnessFetchOptions>;
  readonly sseOptions?: () => {
    readonly queryParams?: Record<string, string>;
  };
  readonly createEventSource?: HarnessEventSourceFactory;
  readonly resume?: {
    readonly getOffset?: () => number;
    readonly setOffset?: (offset: number) => void;
  };
  readonly eventRegistry?: EventRegistry<EventMap>;
};

type HarnessClientBaseUrlOptions = {
  readonly baseUrl: string | URL;
  readonly routes?: HarnessClientRoutes;
};

type HarnessClientLegacyUrlOptions = {
  readonly eventsUrl: string | URL;
  readonly runUrl: string | URL;
  readonly submitUrl?: string | URL;
  readonly resultUrl?: string | URL;
  readonly continueUrl?: string | URL;
  readonly steerUrl?: string | URL;
  readonly followUpUrl?: string | URL;
  readonly cancelUrl?: string | URL;
};

type HarnessClientAdapterOptions = {
  readonly adapter: HarnessClientAdapter;
};

type HarnessNetworkingOptions = MakeExclusive<{
  "'adapter'": HarnessClientAdapterOptions;
  "'baseUrl'": HarnessClientBaseUrlOptions;
  "legacy URLs": HarnessClientLegacyUrlOptions;
}>;

export type CreateHarnessClientOptions<TAgents extends HarnessClientAgents> =
  HarnessClientSharedOptions<TAgents> & HarnessNetworkingOptions;

type HarnessClientAgents = Record<
  string,
  {
    readonly input: Codec<any, unknown>;
    readonly output: Codec<any, unknown>;
  }
>;

type HarnessClientInput<TAgent> = TAgent extends { readonly input: Codec<infer TInput, unknown> }
  ? TInput
  : never;

type HarnessClientOutput<TAgent> = TAgent extends { readonly output: Codec<infer TOutput, unknown> }
  ? TOutput
  : never;

export type HarnessProgressUpdate =
  | { readonly type: "text"; readonly content: string }
  | { readonly type: "thinking"; readonly content: string }
  | {
      readonly type: "tool";
      readonly content: {
        readonly status: "running" | "done";
        readonly toolExecutionId: string;
        readonly name?: string;
        readonly result?: unknown;
        readonly error?: unknown;
      };
    };

export interface HarnessToolUpdate {
  readonly toolExecutionId: string;
  readonly name?: string;
  readonly status: "running" | "done";
  readonly result?: unknown;
  readonly error?: unknown;
}

export interface HarnessEventResult {
  readonly text: string;
  readonly events: ReadonlyArray<AnyEventEnvelope<EventMap>>;
  readonly terminal: "done" | "error" | "cancelled" | "stream_end";
  readonly turnId?: string;
}

export interface HarnessEventViews<TMap extends object = EventMap> extends AsyncIterable<
  AnyEventEnvelope<TMap>
> {
  readonly deltas: () => AsyncIterable<string>;
  readonly progress: () => AsyncIterable<HarnessProgressUpdate>;
  readonly tools: () => AsyncIterable<HarnessToolUpdate>;
  readonly result: () => Promise<HarnessEventResult>;
}

export function createHarnessEventViews(
  streamFactory: () => AsyncIterable<AnyEventEnvelope<EventMap>>,
): HarnessEventViews<EventMap> {
  interface StreamSubscriber {
    readonly push: (event: AnyEventEnvelope<EventMap>) => void;
    readonly close: () => void;
    readonly fail: (error: unknown) => void;
  }

  function isAbortError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { readonly name?: unknown }).name === "AbortError"
    );
  }

  const subscribers = new Set<StreamSubscriber>();
  const eventsList: Array<AnyEventEnvelope<EventMap>> = [];
  let text = "";
  let started = false;
  let finished = false;

  let resolveResult: ((value: HarnessEventResult) => void) | undefined;
  let rejectResult: ((reason?: unknown) => void) | undefined;
  const resultPromise = new Promise<HarnessEventResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function emitToSubscribers(event: AnyEventEnvelope<EventMap>): void {
    for (const subscriber of subscribers) {
      subscriber.push(event);
    }
  }

  function closeSubscribers(): void {
    for (const subscriber of subscribers) {
      subscriber.close();
    }
    subscribers.clear();
  }

  function failSubscribers(error: unknown): void {
    for (const subscriber of subscribers) {
      subscriber.fail(error);
    }
    subscribers.clear();
  }

  function finish(terminal: HarnessEventResult["terminal"], turnId?: string): void {
    if (finished) {
      return;
    }

    finished = true;
    resolveResult?.({
      text,
      events: eventsList,
      terminal,
      turnId,
    });
    closeSubscribers();
  }

  function fail(error: unknown): void {
    if (finished) {
      return;
    }

    finished = true;
    rejectResult?.(error);
    failSubscribers(error);
  }

  function ensureStarted(): void {
    if (started) {
      return;
    }

    started = true;
    void (async () => {
      try {
        for await (const event of streamFactory()) {
          eventsList.push(event);
          if (event.type === "assistant_text_delta") {
            text += event.payload.delta;
          }

          emitToSubscribers(event);

          if (event.type === "turn_done") {
            finish("done", event.turnId ? String(event.turnId) : undefined);
            return;
          }

          if (event.type === "turn_error") {
            finish("error", event.turnId ? String(event.turnId) : undefined);
            return;
          }

          if (event.type === "turn_cancelled") {
            finish("cancelled", event.turnId ? String(event.turnId) : undefined);
            return;
          }
        }

        finish("stream_end", undefined);
      } catch (error) {
        if (isAbortError(error)) {
          finish("stream_end", undefined);
          return;
        }

        fail(error);
      }
    })();
  }

  function events(): AsyncIterable<AnyEventEnvelope<EventMap>> {
    const items: Array<AnyEventEnvelope<EventMap>> = [];
    const waiters: Array<{
      readonly resolve: (value: IteratorResult<AnyEventEnvelope<EventMap>>) => void;
      readonly reject: (reason?: unknown) => void;
    }> = [];
    let closed = false;
    let failure: unknown;

    const subscriber: StreamSubscriber = {
      push: (event) => {
        if (closed || failure !== undefined) {
          return;
        }

        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve({ value: event, done: false });
          return;
        }

        items.push(event);
      },
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        for (const waiter of waiters.splice(0)) {
          waiter.resolve({ value: undefined, done: true });
        }
      },
      fail: (error) => {
        if (closed) {
          return;
        }

        failure = error;
        for (const waiter of waiters.splice(0)) {
          waiter.reject(error);
        }
      },
    };

    subscribers.add(subscriber);
    ensureStarted();

    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (items.length > 0) {
              const item = items.shift();
              if (item === undefined) {
                return Promise.resolve({ value: undefined, done: true });
              }
              return Promise.resolve({ value: item, done: false });
            }

            if (failure !== undefined) {
              return Promise.reject(failure);
            }

            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }

            return new Promise<IteratorResult<AnyEventEnvelope<EventMap>>>((resolve, reject) => {
              waiters.push({ resolve, reject });
            });
          },
          return() {
            subscribers.delete(subscriber);
            subscriber.close();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  function deltas(): AsyncIterable<string> {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of events()) {
          if (event.type === "assistant_text_delta") {
            yield event.payload.delta;
          }
        }
      },
    };
  }

  function progress(): AsyncIterable<HarnessProgressUpdate> {
    const toolNames = new Map<string, string>();

    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of events()) {
          if (event.type === "assistant_text_delta") {
            yield { type: "text", content: event.payload.delta };
            continue;
          }

          if (event.type === "assistant_thinking_delta") {
            yield { type: "thinking", content: event.payload.delta };
            continue;
          }

          if (event.type === "tool_execution_start") {
            const toolExecutionId = String(event.payload.toolExecutionId);
            const name = event.payload.toolName;
            toolNames.set(toolExecutionId, name);
            yield {
              type: "tool",
              content: {
                status: "running",
                toolExecutionId,
                name,
              },
            };
            continue;
          }

          if (event.type === "tool_execution_result") {
            const toolExecutionId = String(event.payload.toolExecutionId);
            yield {
              type: "tool",
              content: {
                status: "done",
                toolExecutionId,
                name: toolNames.get(toolExecutionId),
                result: event.payload.ok ? event.payload.output : undefined,
                error: event.payload.ok ? undefined : event.payload.error,
              },
            };
          }
        }
      },
    };
  }

  function tools(): AsyncIterable<HarnessToolUpdate> {
    const toolNames = new Map<string, string>();

    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of events()) {
          if (event.type === "tool_execution_start") {
            const toolExecutionId = String(event.payload.toolExecutionId);
            const name = event.payload.toolName;
            toolNames.set(toolExecutionId, name);
            yield {
              toolExecutionId,
              name,
              status: "running",
            };
            continue;
          }

          if (event.type === "tool_execution_result") {
            const toolExecutionId = String(event.payload.toolExecutionId);
            yield {
              toolExecutionId,
              name: toolNames.get(toolExecutionId),
              status: "done",
              result: event.payload.ok ? event.payload.output : undefined,
              error: event.payload.ok ? undefined : event.payload.error,
            };
          }
        }
      },
    };
  }

  async function result(): Promise<HarnessEventResult> {
    ensureStarted();
    return resultPromise;
  }

  return {
    deltas,
    progress,
    tools,
    result,
    [Symbol.asyncIterator]() {
      return events()[Symbol.asyncIterator]();
    },
  };
}

export interface AgentSession<TAgent extends HarnessClientAgents[string]> {
  readonly sessionId: string;
  readonly events: (options?: { readonly signal?: AbortSignal }) => HarnessEventViews<EventMap>;
  readonly submit: (
    input: HarnessClientInput<TAgent>,
    options?: { readonly idempotencyKey?: string },
  ) => Promise<{ readonly turnId: string }>;
  readonly result: (turnId: string) => Promise<HarnessClientOutput<TAgent>>;
  readonly run: (
    input: HarnessClientInput<TAgent>,
    options?: { readonly idempotencyKey?: string },
  ) => Promise<HarnessClientOutput<TAgent>>;
  readonly continue: (options?: {
    readonly idempotencyKey?: string;
  }) => Promise<HarnessClientOutput<TAgent>>;
  readonly steer: (content: string) => Promise<void>;
  readonly followUp: (content: string) => Promise<void>;
  readonly cancel: (reason?: string) => Promise<void>;
  readonly waitForIdle: (options?: { readonly signal?: AbortSignal }) => Promise<void>;
}

type CreateHarnessClientFromAdapterOptions<TAgents extends HarnessClientAgents> = {
  readonly agents: TAgents;
  readonly adapter: HarnessClientAdapter;
  readonly eventRegistry: EventRegistry<EventMap>;
  readonly resume?: {
    readonly getOffset?: () => number;
    readonly setOffset?: (offset: number) => void;
  };
};

function decodeEventEnvelope(
  eventRegistry: EventRegistry<EventMap>,
  wireEvent: WireEventEnvelope,
  fallbackSessionId?: string,
): AnyEventEnvelope<EventMap> {
  const definition = eventRegistry[wireEvent.type as keyof EventMap];
  if (!definition) {
    throw new TypeError(`Unknown event type '${wireEvent.type}'`);
  }

  const resolvedSessionId = wireEvent.sessionId ?? fallbackSessionId;
  if (!resolvedSessionId) {
    throw new TypeError("SSE envelope is missing a valid sessionId");
  }

  return {
    type: wireEvent.type as keyof EventMap,
    index: toEventIndex(wireEvent.index),
    turnId: wireEvent.turnId,
    sessionId: toSessionId(resolvedSessionId),
    ts: wireEvent.ts ?? new Date().toISOString(),
    payload: definition.codec.decode(wireEvent.payload),
    schemaVersion: 1,
  } as AnyEventEnvelope<EventMap>;
}

function createHarnessClientFromAdapter<TAgents extends HarnessClientAgents>(
  options: CreateHarnessClientFromAdapterOptions<TAgents>,
) {
  function getAgentDefinition<TKey extends keyof TAgents & string>(key: TKey): TAgents[TKey] {
    const agent = options.agents[key];
    if (!agent) {
      throw new TypeError(`Unknown agent '${key}'`);
    }

    return agent;
  }

  async function runAgent<TKey extends keyof TAgents & string>(
    agent: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly idempotencyKey: string;
      readonly input: HarnessClientInput<TAgents[TKey]>;
    },
  ): Promise<{
    readonly output: HarnessClientOutput<TAgents[TKey]>;
    readonly turnId: string;
    readonly nextIndex: number;
  }> {
    const agentDefinition = getAgentDefinition(agent);
    const response = await options.adapter.run({
      sessionId: runOptions.sessionId,
      idempotencyKey: runOptions.idempotencyKey,
      agent,
      input: agentDefinition.input.encode(runOptions.input),
    });

    return {
      output: agentDefinition.output.decode(response.output) as HarnessClientOutput<TAgents[TKey]>,
      turnId: response.turnId,
      nextIndex: response.nextIndex,
    };
  }

  async function submitAgent<TKey extends keyof TAgents & string>(
    agent: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly idempotencyKey: string;
      readonly input: HarnessClientInput<TAgents[TKey]>;
    },
  ): Promise<{ readonly turnId: string }> {
    const agentDefinition = getAgentDefinition(agent);
    const response = await options.adapter.submit({
      sessionId: runOptions.sessionId,
      idempotencyKey: runOptions.idempotencyKey,
      agent,
      input: agentDefinition.input.encode(runOptions.input),
    });

    return {
      turnId: response.turnId,
    };
  }

  async function resultAgent<TKey extends keyof TAgents & string>(
    agent: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly turnId: string;
    },
  ): Promise<{
    readonly output: HarnessClientOutput<TAgents[TKey]>;
    readonly turnId: string;
    readonly nextIndex: number;
  }> {
    const agentDefinition = getAgentDefinition(agent);
    const response = await options.adapter.result({
      sessionId: runOptions.sessionId,
      turnId: runOptions.turnId,
      agent,
    });

    return {
      output: agentDefinition.output.decode(response.output) as HarnessClientOutput<TAgents[TKey]>,
      turnId: response.turnId,
      nextIndex: response.nextIndex,
    };
  }

  async function continueAgent<TKey extends keyof TAgents & string>(
    agent: TKey,
    runOptions: {
      readonly sessionId: string;
      readonly idempotencyKey: string;
    },
  ): Promise<{
    readonly output: HarnessClientOutput<TAgents[TKey]>;
    readonly turnId: string;
    readonly nextIndex: number;
  }> {
    const agentDefinition = getAgentDefinition(agent);
    const response = await options.adapter.continue({
      sessionId: runOptions.sessionId,
      idempotencyKey: runOptions.idempotencyKey,
      agent,
    });

    return {
      output: agentDefinition.output.decode(response.output) as HarnessClientOutput<TAgents[TKey]>,
      turnId: response.turnId,
      nextIndex: response.nextIndex,
    };
  }

  function streamEvents(
    request: {
      readonly sessionId?: string;
      readonly offset?: number;
    },
    eventOptions?: { readonly signal?: AbortSignal },
  ): AsyncIterable<AnyEventEnvelope<EventMap>> {
    const eventRegistry = options.eventRegistry;
    const wireStream = options.adapter.events(request, { signal: eventOptions?.signal });

    return {
      async *[Symbol.asyncIterator]() {
        const bufferedByIndex = new Map<number, AnyEventEnvelope<EventMap>>();
        let nextExpectedIndex = request.offset ?? 0;

        const emitInOrder = function* (
          envelope: AnyEventEnvelope<EventMap>,
        ): Generator<AnyEventEnvelope<EventMap>> {
          const eventIndex = Number(envelope.index);

          if (eventIndex < nextExpectedIndex) {
            return;
          }

          if (eventIndex > nextExpectedIndex) {
            if (!bufferedByIndex.has(eventIndex)) {
              bufferedByIndex.set(eventIndex, envelope);
            }
            return;
          }

          options.resume?.setOffset?.(eventIndex + 1);
          yield envelope;
          nextExpectedIndex += 1;

          while (true) {
            const nextEnvelope = bufferedByIndex.get(nextExpectedIndex);
            if (!nextEnvelope) {
              break;
            }

            bufferedByIndex.delete(nextExpectedIndex);
            options.resume?.setOffset?.(nextExpectedIndex + 1);
            yield nextEnvelope;
            nextExpectedIndex += 1;
          }
        };

        for await (const wireEvent of wireStream) {
          const envelope = decodeEventEnvelope(eventRegistry, wireEvent, request.sessionId);

          for (const orderedEnvelope of emitInOrder(envelope)) {
            yield orderedEnvelope;
          }
        }

        if (bufferedByIndex.size === 0) {
          return;
        }

        const remainingIndexes = [...bufferedByIndex.keys()].sort((left, right) => left - right);
        for (const remainingIndex of remainingIndexes) {
          const remainingEnvelope = bufferedByIndex.get(remainingIndex);
          if (!remainingEnvelope) {
            continue;
          }

          options.resume?.setOffset?.(remainingIndex + 1);
          yield remainingEnvelope;
        }
      },
    };
  }

  async function sendSessionCommand(
    type: "steer" | "followUp" | "cancel",
    body: { readonly sessionId: string; readonly content?: string },
  ): Promise<void> {
    if (type === "steer") {
      await options.adapter.steer(body);
      return;
    }

    if (type === "followUp") {
      await options.adapter.followUp(body);
      return;
    }

    await options.adapter.cancel(body);
  }

  return {
    run: runAgent,

    continue: continueAgent,

    events(eventOptions?: { readonly signal?: AbortSignal }) {
      const offset = options.resume?.getOffset?.();
      return createHarnessEventViews(() => streamEvents({ offset }, eventOptions));
    },

    session<TKey extends keyof TAgents & string>(
      sessionId: string,
      agent: TKey,
    ): AgentSession<TAgents[TKey]> {
      return {
        sessionId,
        events: (eventOptions) => {
          const offset = options.resume?.getOffset?.();
          return createHarnessEventViews(() =>
            streamEvents(
              {
                sessionId,
                offset,
              },
              eventOptions,
            ),
          );
        },
        async run(input, runOptions) {
          const result = await runAgent(agent, {
            sessionId,
            idempotencyKey: runOptions?.idempotencyKey ?? crypto.randomUUID(),
            input,
          });
          return result.output;
        },
        async submit(input, runOptions) {
          return submitAgent(agent, {
            sessionId,
            idempotencyKey: runOptions?.idempotencyKey ?? crypto.randomUUID(),
            input,
          });
        },
        async result(turnId) {
          const result = await resultAgent(agent, {
            sessionId,
            turnId,
          });
          return result.output;
        },
        async continue(runOptions) {
          const result = await continueAgent(agent, {
            sessionId,
            idempotencyKey: runOptions?.idempotencyKey ?? crypto.randomUUID(),
          });
          return result.output;
        },
        async steer(content) {
          await sendSessionCommand("steer", { sessionId, content });
        },
        async followUp(content) {
          await sendSessionCommand("followUp", { sessionId, content });
        },
        async cancel(reason) {
          await sendSessionCommand("cancel", { sessionId, content: reason });
        },
        async waitForIdle(waitOptions) {
          for await (const event of this.events(waitOptions)) {
            if (
              event.type === "turn_done" ||
              event.type === "turn_error" ||
              event.type === "turn_cancelled"
            ) {
              return;
            }
          }
        },
      };
    },
  };
}

export function createHarnessClient<TAgents extends HarnessClientAgents>(
  options: CreateHarnessClientOptions<TAgents>,
) {
  const opts = options as HarnessClientSharedOptions<TAgents> &
    (HarnessClientAdapterOptions | HarnessClientBaseUrlOptions | HarnessClientLegacyUrlOptions);

  const eventRegistry =
    opts.eventRegistry ??
    defineEventRegistryFromMap({
      defaultCodec: codec.superJson,
    });

  const adapter =
    "adapter" in opts && opts.adapter
      ? opts.adapter
      : createFetchHarnessAdapter({
          baseUrl: "baseUrl" in opts ? opts.baseUrl : undefined,
          routes: "routes" in opts ? opts.routes : undefined,
          eventsUrl: "eventsUrl" in opts ? opts.eventsUrl : undefined,
          runUrl: "runUrl" in opts ? opts.runUrl : undefined,
          submitUrl: "submitUrl" in opts ? opts.submitUrl : undefined,
          resultUrl: "resultUrl" in opts ? opts.resultUrl : undefined,
          continueUrl: "continueUrl" in opts ? opts.continueUrl : undefined,
          steerUrl: "steerUrl" in opts ? opts.steerUrl : undefined,
          followUpUrl: "followUpUrl" in opts ? opts.followUpUrl : undefined,
          cancelUrl: "cancelUrl" in opts ? opts.cancelUrl : undefined,
          queryParams: opts.queryParams,
          fetch: opts.fetch,
          fetchOptions: opts.fetchOptions,
          sseOptions: opts.sseOptions,
          createEventSource: opts.createEventSource,
        } satisfies CreateFetchHarnessAdapterOptions);

  return createHarnessClientFromAdapter({
    agents: opts.agents,
    adapter,
    eventRegistry,
    resume: opts.resume,
  });
}
