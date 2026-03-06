import {
  agentLoop,
  agentLoopContinue,
  type AgentContext,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type StreamFn,
} from "@mariozechner/pi-agent-core";

import { TURN_ERROR_CODE } from "~/errors";
import {
  type AnyEventEnvelope,
  type EventEnvelope,
  type EventIndex,
  type EventMap,
  type EventRegistry,
  type EventType,
  type MessageId,
  type SessionId,
  type ToolExecutionId,
  type TurnId,
  toEventIndex,
  toMessageId,
  toSessionId,
  toToolExecutionId,
  toTurnId,
} from "~/protocol";
import type { Runtime } from "~/runtime";

export interface EventFlowIds {
  readonly turn: () => TurnId;
  readonly message: (kind?: string) => MessageId;
  readonly toolExecution: (
    turnId: TurnId,
    toolCallOrdinal: number,
    toolName: string,
  ) => ToolExecutionId;
}

export interface EventFlow<TMap extends object = EventMap> {
  readonly sessionId: SessionId;
  readonly ids: EventFlowIds;
  readonly emit: <TType extends EventType<TMap>>(
    type: TType,
    payload: TMap[TType],
    options?: { readonly turnId?: TurnId | string; readonly index?: EventIndex | number },
  ) => EventEnvelope<TMap, TType>;
  readonly events: () => ReadonlyArray<AnyEventEnvelope<TMap>>;
  readonly nextIndex: () => EventIndex;
  readonly beginTurn: (turnId?: TurnId | string) => TurnId;
  readonly currentTurnId: () => TurnId;
  readonly setAssistantMessageId: (messageId?: MessageId | string) => MessageId;
  readonly currentAssistantMessageId: () => MessageId;
}

export interface CreateEventFlowOptions {
  readonly sessionId: SessionId | string;
  readonly startIndex?: EventIndex | number;
  readonly now?: () => string;
  readonly turnIdFactory?: () => TurnId;
  readonly messageIdFactory?: (kind?: string) => MessageId;
  readonly toolExecutionIdFactory?: (
    turnId: TurnId,
    toolCallOrdinal: number,
    toolName: string,
  ) => ToolExecutionId;
}

function normalizeSessionId(sessionId: SessionId | string): SessionId {
  return typeof sessionId === "string" ? toSessionId(sessionId) : sessionId;
}

function normalizeTurnId(turnId: TurnId | string): TurnId {
  return typeof turnId === "string" ? toTurnId(turnId) : turnId;
}

function normalizeMessageId(messageId: MessageId | string): MessageId {
  return typeof messageId === "string" ? toMessageId(messageId) : messageId;
}

function normalizeEventIndex(index: EventIndex | number): EventIndex {
  return typeof index === "number" ? toEventIndex(index) : index;
}

export function createEventFlow<TMap extends object = EventMap>(
  options: CreateEventFlowOptions,
): EventFlow<TMap> {
  const now = options.now ?? (() => new Date().toISOString());
  const sessionId = normalizeSessionId(options.sessionId);
  const events: Array<AnyEventEnvelope<TMap>> = [];

  let indexCounter = Number(normalizeEventIndex(options.startIndex ?? 0));
  let activeTurnId: TurnId | undefined;
  let assistantMessageId: MessageId | undefined;

  const ids: EventFlowIds = {
    turn: () =>
      options.turnIdFactory ? options.turnIdFactory() : toTurnId(`turn-${crypto.randomUUID()}`),
    message: (kind) =>
      options.messageIdFactory
        ? options.messageIdFactory(kind)
        : toMessageId(`${kind ?? "msg"}-${crypto.randomUUID()}`),
    toolExecution: (turnId, toolCallOrdinal, toolName) =>
      options.toolExecutionIdFactory
        ? options.toolExecutionIdFactory(turnId, toolCallOrdinal, toolName)
        : toToolExecutionId(`${turnId}:${toolCallOrdinal}:${toolName}`),
  };

  function beginTurn(turnId?: TurnId | string): TurnId {
    activeTurnId = turnId ? normalizeTurnId(turnId) : ids.turn();
    return activeTurnId;
  }

  function currentTurnId(): TurnId {
    if (!activeTurnId) {
      activeTurnId = ids.turn();
    }

    return activeTurnId;
  }

  function setAssistantMessageId(messageId?: MessageId | string): MessageId {
    assistantMessageId = messageId ? normalizeMessageId(messageId) : ids.message("assistant");
    return assistantMessageId;
  }

  function currentAssistantMessageId(): MessageId {
    if (!assistantMessageId) {
      assistantMessageId = ids.message("assistant");
    }

    return assistantMessageId;
  }

  function emit<TType extends EventType<TMap>>(
    type: TType,
    payload: TMap[TType],
    emitOptions?: { readonly turnId?: TurnId | string; readonly index?: EventIndex | number },
  ): EventEnvelope<TMap, TType> {
    const envelopeIndexNumber = emitOptions?.index
      ? Number(normalizeEventIndex(emitOptions.index))
      : indexCounter;

    indexCounter = Math.max(indexCounter, envelopeIndexNumber + 1);

    const envelope: EventEnvelope<TMap, TType> = {
      index: toEventIndex(envelopeIndexNumber),
      sessionId,
      turnId: emitOptions?.turnId ? normalizeTurnId(emitOptions.turnId) : activeTurnId,
      type,
      ts: now(),
      payload,
      schemaVersion: 1,
    };

    events.push(envelope as AnyEventEnvelope<TMap>);
    return envelope;
  }

  return {
    sessionId,
    ids,
    emit,
    events: () => events,
    nextIndex: () => toEventIndex(indexCounter),
    beginTurn,
    currentTurnId,
    setAssistantMessageId,
    currentAssistantMessageId,
  };
}

export type PiAssistantMessageEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "thinking_delta"; readonly delta: string }
  | { readonly type: "toolcall_delta"; readonly toolCallOrdinal: number; readonly delta: unknown };

export type PiAgentEvent =
  | { readonly type: "agent_start"; readonly configuration: unknown }
  | { readonly type: "agent_end"; readonly finalState: unknown }
  | {
      readonly type: "message_start";
      readonly messageId: string;
      readonly role: "user" | "assistant" | "system" | "toolResult";
    }
  | {
      readonly type: "message_end";
      readonly messageId: string;
      readonly role: "user" | "assistant" | "system" | "toolResult";
    }
  | { readonly type: "turn_queue_cleared" }
  | { readonly type: "message_update"; readonly assistantMessageEvent: PiAssistantMessageEvent }
  | {
      readonly type: "tool_execution_start";
      readonly toolExecutionId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool_execution_update";
      readonly toolExecutionId: string;
      readonly partialResult: unknown;
    }
  | {
      readonly type: "tool_execution_end";
      readonly toolExecutionId: string;
      readonly isError?: boolean;
      readonly result?: unknown;
      readonly error?: unknown;
    };

export interface CreatePiEventMapperOptions {
  readonly flow: EventFlow<EventMap>;
  readonly turnId: TurnId;
  readonly assistantMessageId: MessageId;
  readonly toolExecutionIdFromString?: (value: string) => ToolExecutionId;
}

function toProtocolRole(role: string): "user" | "assistant" | "system" | "toolResult" {
  if (role === "assistant" || role === "system" || role === "toolResult") {
    return role;
  }

  return "user";
}

export function mapAgentEventToPiEvent(event: AgentEvent): PiAgentEvent | null {
  const eventType = String(event.type);

  if (eventType === "queue_cleared") {
    return { type: "turn_queue_cleared" };
  }

  if (event.type === "agent_start") {
    return {
      type: "agent_start",
      configuration: null,
    };
  }

  if (event.type === "agent_end") {
    return {
      type: "agent_end",
      finalState: {
        messages: event.messages,
      },
    };
  }

  if (event.type === "message_start") {
    return {
      type: "message_start",
      messageId: `msg-${crypto.randomUUID()}`,
      role: toProtocolRole(event.message.role),
    };
  }

  if (event.type === "message_end") {
    return {
      type: "message_end",
      messageId: `msg-${crypto.randomUUID()}`,
      role: toProtocolRole(event.message.role),
    };
  }

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

export function createPiEventMapper(options: CreatePiEventMapperOptions) {
  const mapToolExecutionId = options.toolExecutionIdFromString ?? toToolExecutionId;

  return function mapPiEvent(event: PiAgentEvent): ReadonlyArray<AnyEventEnvelope<EventMap>> {
    if (event.type === "agent_start") {
      return [
        options.flow.emit("agent_start", {
          sessionId: options.flow.sessionId,
          configuration: event.configuration,
        }),
      ];
    }

    if (event.type === "agent_end") {
      return [
        options.flow.emit("agent_end", {
          sessionId: options.flow.sessionId,
          finalState: event.finalState,
        }),
      ];
    }

    if (event.type === "message_start") {
      return [
        options.flow.emit("message_start", {
          turnId: options.turnId,
          messageId: toMessageId(event.messageId),
          role: event.role,
        }),
      ];
    }

    if (event.type === "message_end") {
      return [
        options.flow.emit("message_end", {
          turnId: options.turnId,
          messageId: toMessageId(event.messageId),
          role: event.role,
        }),
      ];
    }

    if (event.type === "turn_queue_cleared") {
      return [
        options.flow.emit("turn_queue_cleared", {
          turnId: options.turnId,
        }),
      ];
    }

    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent;

      if (assistantEvent.type === "text_delta") {
        return [
          options.flow.emit("assistant_text_delta", {
            turnId: options.turnId,
            messageId: options.assistantMessageId,
            delta: assistantEvent.delta,
          }),
        ];
      }

      if (assistantEvent.type === "thinking_delta") {
        return [
          options.flow.emit("assistant_thinking_delta", {
            turnId: options.turnId,
            messageId: options.assistantMessageId,
            delta: assistantEvent.delta,
          }),
        ];
      }

      return [
        options.flow.emit("assistant_toolcall_delta", {
          turnId: options.turnId,
          toolCallOrdinal: assistantEvent.toolCallOrdinal,
          delta: assistantEvent.delta,
        }),
      ];
    }

    if (event.type === "tool_execution_start") {
      return [
        options.flow.emit("tool_execution_start", {
          turnId: options.turnId,
          toolExecutionId: mapToolExecutionId(event.toolExecutionId),
          toolName: event.toolName,
        }),
      ];
    }

    if (event.type === "tool_execution_update") {
      return [
        options.flow.emit("tool_execution_update", {
          turnId: options.turnId,
          toolExecutionId: mapToolExecutionId(event.toolExecutionId),
          partial: event.partialResult,
        }),
      ];
    }

    const resultPayload: EventMap["tool_execution_result"] = event.isError
      ? {
          turnId: options.turnId,
          toolExecutionId: mapToolExecutionId(event.toolExecutionId),
          ok: false,
          error: {
            code: TURN_ERROR_CODE.TOOL_ERROR,
            message:
              event.error instanceof Error ? event.error.message : String(event.error ?? "Unknown"),
          },
        }
      : {
          turnId: options.turnId,
          toolExecutionId: mapToolExecutionId(event.toolExecutionId),
          ok: true,
          output: event.result,
        };

    return [options.flow.emit("tool_execution_result", resultPayload)];
  };
}

export interface AgentLoopContextStore<TState = unknown> {
  readonly load: (sessionId: string) => Promise<TState | undefined>;
  readonly save: (sessionId: string, state: TState) => Promise<void>;
}

export interface AgentLoopRunOptions {
  readonly sessionId: string;
  readonly prompts: ReadonlyArray<AgentMessage>;
  readonly context: AgentContext;
  readonly config: AgentLoopConfig;
  readonly signal?: AbortSignal;
  readonly streamFn?: StreamFn;
}

export interface AgentLoopContinueOptions {
  readonly sessionId: string;
  readonly config: AgentLoopConfig;
  readonly signal?: AbortSignal;
  readonly streamFn?: StreamFn;
}

export interface CreateAgentLoopRunnerOptions {
  readonly flow: EventFlow<EventMap>;
  readonly publish: (event: AnyEventEnvelope<EventMap>) => Promise<void>;
  readonly contextStore?: AgentLoopContextStore<AgentContext>;
}

export function createAgentLoopRunner(options: CreateAgentLoopRunnerOptions) {
  async function publishTurnStarted(turnId: TurnId): Promise<void> {
    await options.publish(options.flow.emit("turn_started", { turnId }, { turnId }));
  }

  async function publishTurnDone(turnId: TurnId): Promise<void> {
    await options.publish(options.flow.emit("turn_done", { turnId }, { turnId }));
  }

  return {
    async run(loopOptions: AgentLoopRunOptions): Promise<ReadonlyArray<AgentMessage>> {
      const turnId = options.flow.beginTurn();
      const assistantMessageId = options.flow.setAssistantMessageId();
      const mapper = createPiEventMapper({
        flow: options.flow,
        turnId,
        assistantMessageId,
      });

      await publishTurnStarted(turnId);

      const stream = agentLoop(
        [...loopOptions.prompts],
        loopOptions.context,
        loopOptions.config,
        loopOptions.signal,
        loopOptions.streamFn,
      );

      for await (const event of stream) {
        const mapped = mapAgentEventToPiEvent(event);
        if (!mapped) {
          continue;
        }

        for (const envelope of mapper(mapped)) {
          await options.publish(envelope);
        }
      }

      await options.contextStore?.save(loopOptions.sessionId, loopOptions.context);
      await publishTurnDone(turnId);
      return loopOptions.context.messages;
    },

    async continue(loopOptions: AgentLoopContinueOptions): Promise<ReadonlyArray<AgentMessage>> {
      const context = await options.contextStore?.load(loopOptions.sessionId);
      if (!context) {
        throw new TypeError("No active session context available to continue");
      }

      const turnId = options.flow.beginTurn();
      const assistantMessageId = options.flow.setAssistantMessageId();
      const mapper = createPiEventMapper({
        flow: options.flow,
        turnId,
        assistantMessageId,
      });

      await publishTurnStarted(turnId);

      const stream = agentLoopContinue(
        context,
        loopOptions.config,
        loopOptions.signal,
        loopOptions.streamFn,
      );

      for await (const event of stream) {
        const mapped = mapAgentEventToPiEvent(event);
        if (!mapped) {
          continue;
        }

        for (const envelope of mapper(mapped)) {
          await options.publish(envelope);
        }
      }

      await options.contextStore?.save(loopOptions.sessionId, context);
      await publishTurnDone(turnId);
      return context.messages;
    },
  };
}

export interface PubsubPublisher<TMap extends object = EventMap> {
  readonly publish: (
    topic: string,
    envelope: AnyEventEnvelope<TMap>,
    idempotencyKey?: string,
  ) => Promise<void> | void;
}

export interface CreatePubsubBridgeOptions<TMap extends object = EventMap> {
  readonly publisher: PubsubPublisher<TMap>;
  readonly topicForSession: (sessionId: SessionId | string) => string;
  readonly idempotencyKeyForEvent?: (envelope: AnyEventEnvelope<TMap>) => string;
}

export function createPubsubBridge<TMap extends object = EventMap>(
  options: CreatePubsubBridgeOptions<TMap>,
) {
  function publish(envelope: AnyEventEnvelope<TMap>): Promise<void> {
    const topic = options.topicForSession(envelope.sessionId);
    const idempotencyKey = options.idempotencyKeyForEvent?.(envelope);
    return Promise.resolve(options.publisher.publish(topic, envelope, idempotencyKey));
  }

  return {
    publish,
    async publishMany(events: ReadonlyArray<AnyEventEnvelope<TMap>>): Promise<void> {
      for (const event of events) {
        await publish(event);
      }
    },
  };
}

export interface SessionRunnerRunContext<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object,
  TInput,
  TState,
> {
  readonly runtime: TRuntime;
  readonly eventRegistry: EventRegistry<TMap>;
  readonly input: TInput;
  readonly state: TState;
  readonly flow: EventFlow<TMap>;
  readonly publish: (event: AnyEventEnvelope<TMap>) => Promise<void>;
}

export interface CreateSessionRunnerOptions<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object,
  TInput,
  TState,
  TResult,
> {
  readonly runtime: TRuntime;
  readonly eventRegistry: EventRegistry<TMap>;
  readonly run: (
    context: SessionRunnerRunContext<TRuntime, TMap, TInput, TState>,
  ) => Promise<TResult> | TResult;
}

export interface SessionRunnerExecuteOptions<TInput, TState, TMap extends object> {
  readonly sessionId: SessionId | string;
  readonly input: TInput;
  readonly state: TState;
  readonly startIndex?: EventIndex | number;
  readonly publish?: (event: AnyEventEnvelope<TMap>) => Promise<void> | void;
}

export function createSessionRunner<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object,
  TInput,
  TState,
  TResult,
>(options: CreateSessionRunnerOptions<TRuntime, TMap, TInput, TState, TResult>) {
  return async function runSession(
    executeOptions: SessionRunnerExecuteOptions<TInput, TState, TMap>,
  ): Promise<{
    readonly result: TResult;
    readonly events: ReadonlyArray<AnyEventEnvelope<TMap>>;
    readonly nextIndex: EventIndex;
  }> {
    const flow = createEventFlow<TMap>({
      sessionId: executeOptions.sessionId,
      startIndex: executeOptions.startIndex,
    });

    const publish = async (event: AnyEventEnvelope<TMap>) => {
      if (executeOptions.publish) {
        await executeOptions.publish(event);
      }
    };

    const result = await options.run({
      runtime: options.runtime,
      eventRegistry: options.eventRegistry,
      input: executeOptions.input,
      state: executeOptions.state,
      flow,
      publish,
    });

    return {
      result,
      events: flow.events(),
      nextIndex: flow.nextIndex(),
    };
  };
}
