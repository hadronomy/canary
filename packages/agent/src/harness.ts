import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentState,
  type AgentTool,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Model, ThinkingBudgets, Transport } from "@mariozechner/pi-ai";

import { createRestateApi, type RestateApi } from "~/api";
import type { Codec } from "~/codec";
import { codec } from "~/codec";
import { CLIENT_ERROR_CODE, TURN_ERROR_CODE, TURN_ERROR_STAGE } from "~/errors";
import { createSessionOrchestrator, type SessionOrchestrator } from "~/orchestrator";
import {
  defineEventRegistryFromMap,
  toEventIndex,
  toIdempotencyKey,
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
import { createSseServer, decodeSseWithRegistry } from "~/stream";
import { createEventFlow, createPiEventMapper, mapAgentEventToPiEvent } from "~/workflow";

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
  }) => RestateApi<EventMap, undefined>;
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
  };

  function runResultKey(sessionId: string, turnId: TurnId): string {
    return `${sessionId}:${String(turnId)}`;
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
  ): Promise<HarnessSessionSnapshot<TAgents> | undefined> {
    const cached = sessionSnapshots.get(sessionId);
    if (cached) {
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

    const turnId = flow.beginTurn();
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

    await saveSessionSnapshot(runOptions.sessionId, {
      agent: key,
      inputWire: agentDefinition.input.encode(input) as HarnessAgentInputWire<TAgents[TKey]>,
      context,
      agentState: piAgent.state,
    });

    return {
      output: output as HarnessAgentOutput<TAgents[TKey]>,
      turnId,
      nextIndex: Number(flow.nextIndex()),
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
          });

    runResults.set(runResultKey(String(input.sessionId), result.turnId), {
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

  const restateApi =
    options.adapters?.createApi?.({ orchestrator }) ?? createRestateApi({ orchestrator });

  async function run<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: HarnessRunOptions<
      HarnessAgentInput<TAgents[TKey]>,
      HarnessAgentContext<TAgents[TKey]>
    >,
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);
    const submit = await restateApi.submitTurn(
      {
        sessionId: toSessionId(runOptions.sessionId),
        idempotencyKey: toIdempotencyKey(runOptions.idempotencyKey),
        content: "harness.run",
        metadata: {
          agent: key,
          intent: "run",
          input: agentDefinition.input.encode(runOptions.input),
          context: runOptions.context,
        },
      },
      undefined,
    );

    const stored = runResults.get(runResultKey(runOptions.sessionId, submit.turnId));
    if (!stored) {
      throw new TypeError(`No run result found for turn '${submit.turnId}'`);
    }

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
    const submit = await restateApi.submitTurn(
      {
        sessionId: toSessionId(runOptions.sessionId),
        idempotencyKey: toIdempotencyKey(runOptions.idempotencyKey),
        content: "harness.continue",
        metadata: {
          agent: key,
          intent: "continue",
        },
      },
      undefined,
    );

    const stored = runResults.get(runResultKey(runOptions.sessionId, submit.turnId));
    if (!stored) {
      throw new TypeError(`No continue result found for turn '${submit.turnId}'`);
    }

    const narrowed = storedResultForAgent(stored, key);

    return {
      output: agentDefinition.output.decode(narrowed.outputWire) as HarnessAgentOutput<
        TAgents[TKey]
      >,
      turnId: submit.turnId,
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

        for (const event of session.events) {
          if (Number(event.index) >= offset) {
            controller.enqueue(
              encoder.encode(
                sessionStream.event(event.type, event.payload, {
                  index: event.index,
                  turnId: event.turnId,
                }),
              ),
            );
          }
        }

        const listener = (chunk: string) => {
          controller.enqueue(encoder.encode(chunk));
        };

        session.listeners.add(listener);

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

type HarnessClientRoutes = {
  readonly run?: string;
  readonly continue?: string;
  readonly events?: string;
  readonly steer?: string;
  readonly followUp?: string;
  readonly cancel?: string;
};

type HarnessClientSharedOptions<TAgents extends HarnessClientAgents> = {
  readonly agents: TAgents;
  readonly queryParams?: Record<string, string>;
  readonly fetch?: HarnessFetch;
  readonly fetchOptions?: () => HarnessFetchOptions | Promise<HarnessFetchOptions>;
  readonly sseOptions?: () => {
    readonly queryParams?: Record<string, string>;
  };
  readonly createEventSource?: (url: string) => {
    onmessage:
      | ((event: {
          readonly data: string;
          readonly lastEventId: string;
          readonly type: string;
        }) => void)
      | null;
    onerror: ((event: unknown) => void) | null;
    close: () => void;
  };
  readonly resume?: {
    readonly getOffset?: () => number;
    readonly setOffset?: (offset: number) => void;
  };
  readonly eventRegistry?: EventRegistry<EventMap>;
};

type HarnessClientBaseUrlOptions = {
  readonly baseUrl: string | URL;
  readonly routes?: HarnessClientRoutes;
  readonly eventsUrl?: never;
  readonly runUrl?: never;
  readonly continueUrl?: never;
  readonly steerUrl?: never;
  readonly followUpUrl?: never;
  readonly cancelUrl?: never;
};

type HarnessClientLegacyUrlOptions = {
  readonly baseUrl?: never;
  readonly routes?: never;
  readonly eventsUrl: string | URL;
  readonly runUrl: string | URL;
  readonly continueUrl?: string | URL;
  readonly steerUrl?: string | URL;
  readonly followUpUrl?: string | URL;
  readonly cancelUrl?: string | URL;
};

export type CreateHarnessClientOptions<TAgents extends HarnessClientAgents> =
  HarnessClientSharedOptions<TAgents> &
    (HarnessClientBaseUrlOptions | HarnessClientLegacyUrlOptions);

type HarnessFetchInit = {
  readonly method?: RequestInit["method"];
  readonly headers?: RequestInit["headers"];
  readonly body?: RequestInit["body"];
  readonly signal?: AbortSignal;
} & Omit<RequestInit, "method" | "headers" | "body" | "signal">;

type HarnessFetchOptions = Omit<HarnessFetchInit, "method" | "body" | "signal">;

type HarnessFetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: <T>() => Promise<T>;
  readonly text: () => Promise<string>;
};

type HarnessFetch = (input: string | URL, init?: HarnessFetchInit) => Promise<HarnessFetchResponse>;

type HarnessClientAgents = Record<
  string,
  {
    readonly input: Codec<any, any>;
    readonly output: Codec<any, any>;
  }
>;

type HarnessClientInput<TAgent> = TAgent extends { readonly input: Codec<infer TInput, any> }
  ? TInput
  : never;

type HarnessClientOutput<TAgent> = TAgent extends { readonly output: Codec<infer TOutput, any> }
  ? TOutput
  : never;

type HarnessClientOutputWire<TAgent> = TAgent extends { readonly output: Codec<any, infer TWire> }
  ? TWire
  : never;

export interface AgentSession<TAgent extends HarnessClientAgents[string]> {
  readonly sessionId: string;
  readonly events: (options?: {
    readonly signal?: AbortSignal;
  }) => AsyncIterable<AnyEventEnvelope<EventMap>>;
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

function resolveEventUrl(
  base: string | URL,
  options?: {
    readonly offset?: number;
    readonly sessionId?: string;
    readonly queryParams?: Record<string, string>;
  },
): string {
  const offset = options?.offset;
  const sessionId = options?.sessionId;
  const queryParams = options?.queryParams;

  if (offset === undefined && sessionId === undefined && !queryParams) {
    return base instanceof URL ? base.toString() : base;
  }

  const parsed = new URL(base instanceof URL ? base.toString() : base, "http://localhost");
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      parsed.searchParams.set(key, value);
    }
  }
  if (offset !== undefined) {
    parsed.searchParams.set("offset", String(offset));
  }
  if (sessionId !== undefined) {
    parsed.searchParams.set("sessionId", sessionId);
  }

  if (base instanceof URL) {
    return parsed.toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function resolveCommandUrl(
  base: string | URL,
  override: string | URL | undefined,
  suffix: string,
): string {
  if (override) {
    return override instanceof URL ? override.toString() : override;
  }

  const normalizedSuffix = suffix.replace(/^\/+/, "");

  const applySiblingPath = (url: URL): URL => {
    const currentPath = url.pathname;
    const parentPath =
      currentPath.endsWith("/") || currentPath.length === 0
        ? currentPath
        : currentPath.slice(0, currentPath.lastIndexOf("/") + 1);
    const joined = `${parentPath}${normalizedSuffix}`.replace(/\/{2,}/g, "/");

    const next = new URL(url.toString());
    next.pathname = joined.startsWith("/") ? joined : `/${joined}`;
    return next;
  };

  if (base instanceof URL) {
    return applySiblingPath(base).toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return applySiblingPath(new URL(base)).toString();
  }

  const parsed = new URL(base, "http://localhost");
  const resolved = applySiblingPath(parsed);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

type HarnessRouteName = "run" | "continue" | "events" | "steer" | "followUp" | "cancel";

type HarnessClientResolvedUrls = Record<HarnessRouteName, string>;

const harnessDefaultRoutes: Record<HarnessRouteName, string> = {
  run: "/run",
  continue: "/continue",
  events: "/events",
  steer: "/steer",
  followUp: "/follow-up",
  cancel: "/cancel",
};

function resolvePathFromBase(base: string | URL, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const joinPath = (basePath: string): string => {
    const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
    return `${prefix}${normalizedPath}`.replace(/\/{2,}/g, "/");
  };

  if (base instanceof URL) {
    const next = new URL(base.toString());
    next.pathname = joinPath(next.pathname);
    return next.toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    const next = new URL(base);
    next.pathname = joinPath(next.pathname);
    return next.toString();
  }

  const parsed = new URL(base, "http://localhost");
  const next = new URL(parsed.toString());
  next.pathname = joinPath(next.pathname);
  return `${next.pathname}${next.search}${next.hash}`;
}

function resolveClientUrls<TAgents extends HarnessClientAgents>(
  options: CreateHarnessClientOptions<TAgents>,
): HarnessClientResolvedUrls {
  if (options.baseUrl !== undefined) {
    const routes = options.routes;
    return {
      run: resolvePathFromBase(options.baseUrl, routes?.run ?? harnessDefaultRoutes.run),
      continue: resolvePathFromBase(
        options.baseUrl,
        routes?.continue ?? harnessDefaultRoutes.continue,
      ),
      events: resolvePathFromBase(options.baseUrl, routes?.events ?? harnessDefaultRoutes.events),
      steer: resolvePathFromBase(options.baseUrl, routes?.steer ?? harnessDefaultRoutes.steer),
      followUp: resolvePathFromBase(
        options.baseUrl,
        routes?.followUp ?? harnessDefaultRoutes.followUp,
      ),
      cancel: resolvePathFromBase(options.baseUrl, routes?.cancel ?? harnessDefaultRoutes.cancel),
    };
  }

  if (!options.runUrl || !options.eventsUrl) {
    throw new TypeError(
      "createHarnessClient requires either baseUrl, or both runUrl and eventsUrl for legacy configuration.",
    );
  }

  const continueUrl =
    options.continueUrl !== undefined
      ? resolveCommandUrl(options.runUrl, options.continueUrl, "/continue")
      : options.runUrl instanceof URL
        ? options.runUrl.toString()
        : options.runUrl;
  const steerUrl = resolveCommandUrl(options.runUrl, options.steerUrl, "/steer");
  const followUpUrl = resolveCommandUrl(options.runUrl, options.followUpUrl, "/follow-up");
  const cancelUrl = resolveCommandUrl(options.runUrl, options.cancelUrl, "/cancel");

  return {
    run: options.runUrl instanceof URL ? options.runUrl.toString() : options.runUrl,
    continue: continueUrl,
    events: options.eventsUrl instanceof URL ? options.eventsUrl.toString() : options.eventsUrl,
    steer: steerUrl,
    followUp: followUpUrl,
    cancel: cancelUrl,
  };
}

function createQueue<T>() {
  const items: Array<T> = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let done = false;

  function push(item: T): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }

    items.push(item);
  }

  function close(): void {
    done = true;
    for (const waiter of waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  function next(): Promise<IteratorResult<T>> {
    if (items.length > 0) {
      const value = items.shift() as T;
      return Promise.resolve({ value, done: false });
    }

    if (done) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
  }

  return { push, close, next };
}

function normalizeHeaders(headers?: RequestInit["headers"]): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized = new Headers(headers);
  const result: Record<string, string> = {};
  normalized.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

function defaultEventSourceFactory() {
  const ctor = (
    globalThis as {
      readonly EventSource?: new (url: string) => {
        onmessage:
          | ((event: {
              readonly data: string;
              readonly lastEventId: string;
              readonly type: string;
            }) => void)
          | null;
        onerror: ((event: unknown) => void) | null;
        close: () => void;
      };
    }
  ).EventSource;

  if (!ctor) {
    throw new TypeError(
      "No EventSource implementation available. Pass createEventSource explicitly.",
    );
  }

  return (url: string) => new ctor(url);
}

export function createHarnessClient<TAgents extends HarnessClientAgents>(
  options: CreateHarnessClientOptions<TAgents>,
) {
  const eventRegistry =
    options.eventRegistry ??
    defineEventRegistryFromMap({
      defaultCodec: codec.superJson,
    });

  const createEventSource = options.createEventSource ?? defaultEventSourceFactory();
  const urls = resolveClientUrls(options);
  const requestQueryParams = options.queryParams;
  const sseQueryParams = options.sseOptions?.().queryParams;
  const eventQueryParams = {
    ...requestQueryParams,
    ...sseQueryParams,
  };

  const defaultFetch: HarnessFetch = async (input, init) => {
    const response = await fetch(typeof input === "string" ? input : input.toString(), {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      json: <T>() => response.json() as Promise<T>,
      text: () => response.text(),
    };
  };

  const fetcher: HarnessFetch = options.fetch ?? defaultFetch;

  async function request(
    input: string | URL,
    init?: HarnessFetchInit,
  ): Promise<HarnessFetchResponse> {
    const requestDefaults = (await options.fetchOptions?.()) ?? {};
    return fetcher(resolveEventUrl(input, { queryParams: requestQueryParams }), {
      ...requestDefaults,
      ...init,
      headers: {
        ...normalizeHeaders(requestDefaults.headers),
        ...normalizeHeaders(init?.headers),
      },
    });
  }

  function getAgentDefinition<TKey extends keyof TAgents & string>(key: TKey): TAgents[TKey] {
    const agent = options.agents[key];
    if (!agent) {
      throw new TypeError(`Unknown agent '${key}'`);
    }

    return agent;
  }

  async function decodeRunResponse<TKey extends keyof TAgents & string>(
    agent: TKey,
    response: HarnessFetchResponse,
  ): Promise<{
    readonly output: HarnessClientOutput<TAgents[TKey]>;
    readonly turnId: string;
    readonly nextIndex: number;
  }> {
    if (!response.ok) {
      throw new TypeError(
        `${CLIENT_ERROR_CODE.HARNESS_HTTP_RUN_FAILED}: status ${response.status}`,
      );
    }

    const payload = (await response.json()) as HarnessRunResponse<
      HarnessClientOutputWire<TAgents[TKey]>
    > & {
      readonly nextOffset?: number;
    };
    const agentDefinition = getAgentDefinition(agent);

    return {
      output: agentDefinition.output.decode(payload.output) as HarnessClientOutput<TAgents[TKey]>,
      turnId: payload.turnId,
      nextIndex: payload.nextIndex ?? payload.nextOffset ?? 0,
    };
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
    const response = await request(urls.run, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: runOptions.sessionId,
        idempotencyKey: runOptions.idempotencyKey,
        agent,
        intent: "run",
        input: agentDefinition.input.encode(runOptions.input),
      }),
    });

    return decodeRunResponse(agent, response);
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
    const response = await request(urls.continue, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: runOptions.sessionId,
        idempotencyKey: runOptions.idempotencyKey,
        agent,
        intent: "continue",
      }),
    });

    return decodeRunResponse(agent, response);
  }

  async function sendSessionCommand(
    url: string,
    body: { readonly sessionId: string; readonly content?: string },
  ): Promise<void> {
    const response = await request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new TypeError(
        `${CLIENT_ERROR_CODE.HARNESS_HTTP_SESSION_COMMAND_FAILED}: status ${response.status}`,
      );
    }
  }

  function openEventsStream(
    url: string,
    eventOptions?: { readonly signal?: AbortSignal },
  ): AsyncIterable<AnyEventEnvelope<EventMap>> {
    const queue = createQueue<AnyEventEnvelope<EventMap>>();
    const source = createEventSource(url);

    source.onmessage = (message) => {
      const envelope = decodeSseWithRegistry(
        {
          id: message.lastEventId || undefined,
          event: message.type || undefined,
          data: message.data,
        },
        eventRegistry,
      );

      options.resume?.setOffset?.(Number(envelope.index) + 1);
      queue.push(envelope);
    };

    source.onerror = () => {
      source.close();
      queue.close();
    };

    eventOptions?.signal?.addEventListener("abort", () => {
      source.close();
      queue.close();
    });

    return {
      [Symbol.asyncIterator]() {
        return {
          next: queue.next,
        };
      },
    };
  }

  return {
    run: runAgent,

    continue: continueAgent,

    events(eventOptions?: { readonly signal?: AbortSignal }) {
      const offset = options.resume?.getOffset?.();
      return openEventsStream(
        resolveEventUrl(urls.events, { offset, queryParams: eventQueryParams }),
        eventOptions,
      );
    },

    session<TKey extends keyof TAgents & string>(
      sessionId: string,
      agent: TKey,
    ): AgentSession<TAgents[TKey]> {
      return {
        sessionId,
        events: (eventOptions) => {
          const offset = options.resume?.getOffset?.();
          return openEventsStream(
            resolveEventUrl(urls.events, {
              offset,
              sessionId,
              queryParams: eventQueryParams,
            }),
            eventOptions,
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
        async continue(runOptions) {
          const result = await continueAgent(agent, {
            sessionId,
            idempotencyKey: runOptions?.idempotencyKey ?? crypto.randomUUID(),
          });
          return result.output;
        },
        async steer(content) {
          await sendSessionCommand(urls.steer, { sessionId, content });
        },
        async followUp(content) {
          await sendSessionCommand(urls.followUp, { sessionId, content });
        },
        async cancel(reason) {
          await sendSessionCommand(urls.cancel, { sessionId, content: reason });
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
