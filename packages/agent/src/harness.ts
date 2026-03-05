import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { Model, ThinkingBudgets, Transport } from "@mariozechner/pi-ai";

import { createRestateApi, type RestateApi } from "~/api";
import type { Codec } from "~/codec";
import { codec } from "~/codec";
import { createSessionOrchestrator, type SessionOrchestrator } from "~/orchestrator";
import { defineEventRegistryFromMap, toSessionId } from "~/protocol";
import {
  toIdempotencyKey,
  toEventIndex,
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
import { createEventFlow, createPiEventMapper, type PiAgentEvent } from "~/workflow";

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
    readonly state: ReturnType<Agent["state"] extends never ? never : () => Agent["state"]>;
    readonly text: string;
  }) => Promise<TOutput> | TOutput;
};

export type HarnessAgents = Record<string, HarnessAgentDefinition<unknown, unknown, unknown>>;

export type HarnessAgentInput<TAgent extends HarnessAgentDefinition<unknown, unknown, unknown>> =
  TAgent extends HarnessAgentDefinition<infer TInput, unknown, unknown> ? TInput : never;

export type HarnessAgentOutput<TAgent extends HarnessAgentDefinition<unknown, unknown, unknown>> =
  TAgent extends HarnessAgentDefinition<unknown, infer TOutput, unknown> ? TOutput : never;

export type HarnessAgentContext<TAgent extends HarnessAgentDefinition<unknown, unknown, unknown>> =
  TAgent extends HarnessAgentDefinition<unknown, unknown, infer TContext> ? TContext : never;

export type HarnessAgentInputWire<
  TAgent extends HarnessAgentDefinition<unknown, unknown, unknown>,
> =
  TAgent extends HarnessAgentDefinition<unknown, unknown, unknown, infer TInputWire, unknown>
    ? TInputWire
    : never;

export type HarnessAgentOutputWire<
  TAgent extends HarnessAgentDefinition<unknown, unknown, unknown>,
> =
  TAgent extends HarnessAgentDefinition<unknown, unknown, unknown, unknown, infer TOutputWire>
    ? TOutputWire
    : never;

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

export function defineAgent<TInput, TOutput, TContext = unknown>(
  definition: HarnessAgentDefinition<TInput, TOutput, TContext>,
): HarnessAgentDefinition<TInput, TOutput, TContext> {
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
}

function mapAgentEventToPiEvent(event: AgentEvent): PiAgentEvent | null {
  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;

    if (assistantMessageEvent.type === "text_delta") {
      return {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: assistantMessageEvent.delta,
        },
      };
    }

    if (assistantMessageEvent.type === "thinking_delta") {
      return {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: assistantMessageEvent.delta,
        },
      };
    }

    if (assistantMessageEvent.type === "toolcall_delta") {
      return {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          toolCallOrdinal: assistantMessageEvent.contentIndex,
          delta: assistantMessageEvent.delta,
        },
      };
    }

    return null;
  }

  if (event.type === "tool_execution_start") {
    return {
      type: "tool_execution_start",
      toolExecutionId: event.toolCallId,
      toolName: event.toolName,
    };
  }

  if (event.type === "tool_execution_update") {
    return {
      type: "tool_execution_update",
      toolExecutionId: event.toolCallId,
      partialResult: event.partialResult,
    };
  }

  if (event.type === "tool_execution_end") {
    return {
      type: "tool_execution_end",
      toolExecutionId: event.toolCallId,
      isError: event.isError,
      result: event.result,
      error: event.isError ? event.result : undefined,
    };
  }

  return null;
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
  const runResults = new Map<string, { outputWire: unknown; nextIndex: number }>();
  const sse = createSseServer({ eventRegistry });

  type SubmitMetadata = {
    readonly agent: keyof TAgents & string;
    readonly input: unknown;
    readonly context: unknown;
  };

  function runResultKey(sessionId: string, turnId: TurnId): string {
    return `${sessionId}:${String(turnId)}`;
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

  async function runInternal<TKey extends keyof TAgents & string>(
    key: TKey,
    runOptions: HarnessRunOptions<
      HarnessAgentInput<TAgents[TKey]>,
      HarnessAgentContext<TAgents[TKey]>
    >,
  ): Promise<HarnessRunResult<HarnessAgentOutput<TAgents[TKey]>>> {
    const agentDefinition = getAgentDefinition(key);

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

    const promptMessage = agentDefinition.prompt
      ? agentDefinition.prompt(runOptions.input, runOptions.context)
      : JSON.stringify(agentDefinition.input.encode(runOptions.input));

    const promptText =
      typeof promptMessage === "string"
        ? promptMessage
        : Array.isArray(promptMessage)
          ? promptMessage.map((message) => JSON.stringify(message)).join("\n")
          : JSON.stringify(promptMessage);

    publish(
      runOptions.sessionId,
      flow.emit("user_message", {
        turnId,
        messageId: userMessageId,
        content: promptText,
      }),
    );
    publish(
      runOptions.sessionId,
      flow.emit("assistant_message_start", {
        turnId,
        messageId: assistantMessageId,
      }),
    );

    const piAgent = new Agent({
      initialState: {
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
      await piAgent.prompt(promptText);

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
      publish(
        runOptions.sessionId,
        flow.emit("turn_error", {
          turnId,
          stage: "llm",
          retrying: false,
          code: "HARNESS_RUN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      unsubscribe();
      throw error;
    }

    unsubscribe();

    const output = await agentDefinition.resolveOutput({
      input: runOptions.input,
      context: runOptions.context,
      state: piAgent.state,
      text: generatedText,
    });

    return {
      // TODO(agent-harness): remove cast by preserving TKey correlation through helper boundaries.
      output: output as HarnessAgentOutput<TAgents[TKey]>,
      turnId,
      nextIndex: Number(flow.nextIndex()),
    };
  }

  async function runViaSubmit(input: SubmitTurnInput): Promise<SubmitTurnResult> {
    const metadata = input.metadata as SubmitMetadata | undefined;
    if (!metadata) {
      throw new TypeError("submitTurn metadata is required");
    }

    const agentDefinition = getAgentDefinition(metadata.agent);
    const decodedInput = agentDefinition.input.decode(
      metadata.input as HarnessAgentInputWire<typeof agentDefinition>,
    ) as HarnessAgentInput<TAgents[keyof TAgents & string]>;

    const result = await runInternal(metadata.agent, {
      sessionId: String(input.sessionId),
      idempotencyKey: String(input.idempotencyKey),
      input: decodedInput,
      context: metadata.context as HarnessAgentContext<typeof agentDefinition>,
    });

    runResults.set(runResultKey(String(input.sessionId), result.turnId), {
      outputWire: agentDefinition.output.encode(result.output),
      nextIndex: result.nextIndex,
    });

    return { turnId: result.turnId };
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
    steer: async (_input: SessionCommandInput): Promise<SessionMutationResult> => ({ ok: true }),
    followUp: async (_input: SessionCommandInput): Promise<SessionMutationResult> => ({ ok: true }),
    cancel: async (_input: SessionCommandInput): Promise<SessionMutationResult> => ({ ok: true }),
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

    return {
      output: agentDefinition.output.decode(
        stored.outputWire as HarnessAgentOutputWire<TAgents[TKey]>,
      ) as HarnessAgentOutput<TAgents[TKey]>,
      turnId: submit.turnId,
      nextIndex: stored.nextIndex,
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

export interface CreateHarnessClientOptions<TAgents extends HarnessAgents> {
  readonly agents: TAgents;
  readonly eventsUrl: string | URL;
  readonly runUrl: string | URL;
  readonly fetch: (
    input: string | URL,
    init?: {
      readonly method?: string;
      readonly headers?: Record<string, string>;
      readonly body?: string;
      readonly signal?: AbortSignal;
    },
  ) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly json: <T>() => Promise<T>;
    readonly text: () => Promise<string>;
  }>;
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
}

function resolveEventUrl(base: string | URL, offset?: number): string {
  if (offset === undefined) {
    return base instanceof URL ? base.toString() : base;
  }

  const parsed = new URL(base instanceof URL ? base.toString() : base, "http://localhost");
  parsed.searchParams.set("offset", String(offset));

  if (base instanceof URL) {
    return parsed.toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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

export function createHarnessClient<TAgents extends HarnessAgents>(
  options: CreateHarnessClientOptions<TAgents>,
) {
  const eventRegistry =
    options.eventRegistry ??
    defineEventRegistryFromMap({
      defaultCodec: codec.superJson,
    });

  const createEventSource = options.createEventSource ?? defaultEventSourceFactory();

  function getAgentDefinition<TKey extends keyof TAgents & string>(key: TKey): TAgents[TKey] {
    const agent = options.agents[key];
    if (!agent) {
      throw new TypeError(`Unknown agent '${key}'`);
    }

    return agent;
  }

  return {
    async run<TKey extends keyof TAgents & string>(
      agent: TKey,
      runOptions: {
        readonly sessionId: string;
        readonly idempotencyKey: string;
        readonly input: HarnessAgentInput<TAgents[TKey]>;
      },
    ): Promise<{
      readonly output: HarnessAgentOutput<TAgents[TKey]>;
      readonly turnId: string;
      readonly nextIndex: number;
    }> {
      const agentDefinition = getAgentDefinition(agent);

      const response = await options.fetch(options.runUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionId: runOptions.sessionId,
          idempotencyKey: runOptions.idempotencyKey,
          agent,
          input: agentDefinition.input.encode(runOptions.input),
        }),
      });

      if (!response.ok) {
        throw new TypeError(`Harness run failed with status ${response.status}`);
      }

      const payload = await response.json<
        HarnessRunResponse<HarnessAgentOutputWire<TAgents[TKey]>> & {
          readonly nextOffset?: number;
        }
      >();

      return {
        // TODO(agent-harness): remove cast by decoding response through per-agent response envelope codec.
        output: agentDefinition.output.decode(payload.output) as HarnessAgentOutput<TAgents[TKey]>,
        turnId: payload.turnId,
        nextIndex: payload.nextIndex ?? payload.nextOffset ?? 0,
      };
    },

    events(eventOptions?: { readonly signal?: AbortSignal }) {
      const queue = createQueue<AnyEventEnvelope<EventMap>>();
      const offset = options.resume?.getOffset?.();
      const source = createEventSource(resolveEventUrl(options.eventsUrl, offset));

      source.onmessage = (message) => {
        const envelope = decodeSseWithRegistry(
          {
            id: message.lastEventId || undefined,
            event: message.type || undefined,
            data: message.data,
          },
          eventRegistry,
        );

        options.resume?.setOffset?.(Number(envelope.index));
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
    },
  };
}
