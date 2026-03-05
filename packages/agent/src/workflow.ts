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

export function createPiEventMapper(options: CreatePiEventMapperOptions) {
  const mapToolExecutionId = options.toolExecutionIdFromString ?? toToolExecutionId;

  return function mapPiEvent(event: PiAgentEvent): ReadonlyArray<AnyEventEnvelope<EventMap>> {
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

    return [
      options.flow.emit("tool_execution_result", {
        turnId: options.turnId,
        toolExecutionId: mapToolExecutionId(event.toolExecutionId),
        ...(event.isError
          ? {
              ok: false,
              error: {
                code: "TOOL_ERROR",
                message:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error ?? "Unknown"),
              },
            }
          : {
              ok: true,
              output: event.result,
            }),
      }),
    ];
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
