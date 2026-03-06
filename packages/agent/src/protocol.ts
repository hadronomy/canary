import type { Codec } from "~/codec";

export declare const brandSymbol: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brandSymbol]: Name };

export type SessionId = Brand<string, "SessionId">;
export type TurnId = Brand<string, "TurnId">;
export type EventIndex = Brand<number, "EventIndex">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type MessageId = Brand<string, "MessageId">;
export type ToolExecutionId = Brand<string, "ToolExecutionId">;

export type TurnState = "queued" | "running" | "done" | "error" | "cancelled";
export type SessionStatus = "open" | "closing" | "closed";
export type TurnErrorStage = "llm" | "tool" | "publish";
export type AssistantStopReason = "stop" | "length" | "toolUse";

export interface ToolExecutionError {
  readonly code: string;
  readonly message: string;
}

export type ToolExecutionResultPayload =
  | {
      readonly turnId: TurnId;
      readonly toolExecutionId: ToolExecutionId;
      readonly ok: true;
      readonly output: unknown;
    }
  | {
      readonly turnId: TurnId;
      readonly toolExecutionId: ToolExecutionId;
      readonly ok: false;
      readonly error: ToolExecutionError;
    };

export interface BaseEventMap {
  readonly session_opened: { readonly sessionId: SessionId };
  readonly agent_start: { readonly sessionId: SessionId; readonly configuration: unknown };
  readonly agent_end: { readonly sessionId: SessionId; readonly finalState: unknown };
  readonly turn_queued: { readonly turnId: TurnId };
  readonly turn_started: { readonly turnId: TurnId };
  readonly turn_queue_cleared: { readonly turnId: TurnId };
  readonly message_start: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly role: "user" | "assistant" | "system" | "toolResult";
  };
  readonly user_message: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly content: string;
  };
  readonly message_end: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly role: "user" | "assistant" | "system" | "toolResult";
  };
  readonly assistant_message_start: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
  };
  readonly assistant_text_delta: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly delta: string;
  };
  readonly assistant_thinking_delta: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly delta: string;
  };
  readonly assistant_toolcall_delta: {
    readonly turnId: TurnId;
    readonly toolCallOrdinal: number;
    readonly delta: unknown;
  };
  readonly tool_execution_start: {
    readonly turnId: TurnId;
    readonly toolExecutionId: ToolExecutionId;
    readonly toolName: string;
  };
  readonly tool_execution_update: {
    readonly turnId: TurnId;
    readonly toolExecutionId: ToolExecutionId;
    readonly partial: unknown;
  };
  readonly tool_execution_result: ToolExecutionResultPayload;
  readonly assistant_message_done: {
    readonly turnId: TurnId;
    readonly messageId: MessageId;
    readonly stopReason: AssistantStopReason;
  };
  readonly turn_done: { readonly turnId: TurnId };
  readonly turn_error: {
    readonly turnId: TurnId;
    readonly stage: TurnErrorStage;
    readonly retrying: boolean;
    readonly code: string;
    readonly message: string;
  };
  readonly turn_cancelled: { readonly turnId: TurnId; readonly reason: string };
  readonly session_closed: { readonly sessionId: SessionId };
}

export type EventMap = BaseEventMap;
export type EventType<TMap extends object = EventMap> = keyof TMap & string;

export type EventEnvelope<
  TMap extends object = EventMap,
  TType extends EventType<TMap> = EventType<TMap>,
> = {
  readonly index: EventIndex;
  readonly sessionId: SessionId;
  readonly turnId?: TurnId;
  readonly type: TType;
  readonly ts: string;
  readonly payload: TMap[TType];
  readonly schemaVersion: 1;
};

export type AnyEventEnvelope<TMap extends object = EventMap> = {
  [T in EventType<TMap>]: EventEnvelope<TMap, T>;
}[EventType<TMap>];

export interface CreateEventEnvelopeInput<TMap extends object, TType extends EventType<TMap>> {
  readonly index: EventIndex;
  readonly sessionId: SessionId;
  readonly type: TType;
  readonly payload: TMap[TType];
  readonly ts?: string;
  readonly turnId?: TurnId;
}

export function createEventEnvelope<TMap extends object, TType extends EventType<TMap>>(
  input: CreateEventEnvelopeInput<TMap, TType>,
): EventEnvelope<TMap, TType> {
  return {
    index: input.index,
    sessionId: input.sessionId,
    turnId: input.turnId,
    type: input.type,
    ts: input.ts ?? new Date().toISOString(),
    payload: input.payload,
    schemaVersion: 1,
  };
}

export interface EventEnvelopeFactoryOptions {
  readonly sessionId: SessionId;
  readonly now?: () => string;
}

export function createEventEnvelopeFactory<TMap extends object = EventMap>(
  options: EventEnvelopeFactoryOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());

  return function makeEnvelope<TType extends EventType<TMap>>(input: {
    readonly index: EventIndex;
    readonly type: TType;
    readonly payload: TMap[TType];
    readonly turnId?: TurnId;
  }): EventEnvelope<TMap, TType> {
    return {
      index: input.index,
      sessionId: options.sessionId,
      turnId: input.turnId,
      type: input.type,
      ts: now(),
      payload: input.payload,
      schemaVersion: 1,
    };
  };
}

export interface SessionSnapshot<TMap extends object = EventMap> {
  readonly sessionId: SessionId;
  readonly status: SessionStatus;
  readonly activeTurnId: TurnId | null;
  readonly lastIndex: EventIndex;
  readonly events?: ReadonlyArray<AnyEventEnvelope<TMap>>;
}

export interface SubmitTurnInput {
  readonly sessionId: SessionId;
  readonly idempotencyKey: IdempotencyKey;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SubmitTurnResult {
  readonly turnId: TurnId;
}

export interface SessionCommandInput {
  readonly sessionId: SessionId;
  readonly content?: string;
}

export interface SessionMutationResult {
  readonly ok: true;
}

export interface EventDefinition<TType extends string, TPayload> {
  readonly type: TType;
  readonly codec: Codec<TPayload>;
}

export interface CommandDefinition<TName extends string, TInput, TOutput, TError = never> {
  readonly name: TName;
  readonly input: Codec<TInput>;
  readonly output: Codec<TOutput>;
  readonly error?: Codec<TError>;
}

export type EventRegistry<TMap extends object = EventMap> = {
  readonly [T in EventType<TMap>]: EventDefinition<T, TMap[T]>;
};

export interface EventRegistryBuilder<TMap extends object = EventMap> {
  readonly withDefaultCodec: (codec: Codec<unknown>) => EventRegistryBuilder<TMap>;
  readonly event: <TType extends EventType<TMap>>(
    type: TType,
    codec: Codec<TMap[TType]>,
  ) => EventRegistryBuilder<TMap>;
  readonly events: (...types: ReadonlyArray<EventType<TMap>>) => EventRegistry<TMap>;
}

export const baseEventTypes = [
  "session_opened",
  "agent_start",
  "agent_end",
  "turn_queued",
  "turn_started",
  "turn_queue_cleared",
  "message_start",
  "user_message",
  "message_end",
  "assistant_message_start",
  "assistant_text_delta",
  "assistant_thinking_delta",
  "assistant_toolcall_delta",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_result",
  "assistant_message_done",
  "turn_done",
  "turn_error",
  "turn_cancelled",
  "session_closed",
] as const satisfies ReadonlyArray<EventType<EventMap>>;

export function defineEvent<TType extends string, TPayload>(
  type: TType,
  codec: Codec<TPayload>,
): EventDefinition<TType, TPayload> {
  return { type, codec };
}

export function defineEventRegistry<TMap extends object = EventMap>(): EventRegistryBuilder<TMap> {
  const explicitCodecs: Partial<{ [T in EventType<TMap>]: Codec<TMap[T]> }> = {};
  let defaultCodec: Codec<unknown> | undefined;

  function withDefaultCodec(codec: Codec<unknown>): EventRegistryBuilder<TMap> {
    defaultCodec = codec;
    return builder;
  }

  function event<TType extends EventType<TMap>>(
    type: TType,
    codec: Codec<TMap[TType]>,
  ): EventRegistryBuilder<TMap> {
    explicitCodecs[type] = codec;
    return builder;
  }

  function events(...types: ReadonlyArray<EventType<TMap>>): EventRegistry<TMap> {
    const registry: Partial<EventRegistry<TMap>> = {};

    for (const type of types) {
      const explicitCodec = explicitCodecs[type];
      const resolvedCodec = explicitCodec ?? (defaultCodec as Codec<TMap[typeof type]> | undefined);

      if (!resolvedCodec) {
        throw new TypeError(
          `No codec registered for event '${type}'. Set a default codec with withDefaultCodec(...) or override with event(...).`,
        );
      }

      registry[type] = defineEvent(type, resolvedCodec) as EventDefinition<
        EventType<TMap>,
        TMap[EventType<TMap>]
      >;
    }

    return registry as EventRegistry<TMap>;
  }

  const builder: EventRegistryBuilder<TMap> = {
    withDefaultCodec,
    event,
    events,
  };

  return builder;
}

export function defineEventRegistryFromMap(options: {
  readonly defaultCodec: Codec<unknown>;
  readonly overrides?: Partial<{ [T in EventType<EventMap>]: Codec<EventMap[T]> }>;
}): EventRegistry<EventMap>;
export function defineEventRegistryFromMap<TMap extends object>(options: {
  readonly eventTypes: ReadonlyArray<EventType<TMap>>;
  readonly defaultCodec: Codec<unknown>;
  readonly overrides?: Partial<{ [T in EventType<TMap>]: Codec<TMap[T]> }>;
}): EventRegistry<TMap>;
export function defineEventRegistryFromMap<TMap extends object>(options: {
  readonly eventTypes?: ReadonlyArray<EventType<TMap>>;
  readonly defaultCodec: Codec<unknown>;
  readonly overrides?: Partial<{ [T in EventType<TMap>]: Codec<TMap[T]> }>;
}): EventRegistry<TMap> {
  const eventTypes = (options.eventTypes ?? baseEventTypes) as ReadonlyArray<EventType<TMap>>;
  const builder = defineEventRegistry<TMap>().withDefaultCodec(options.defaultCodec);

  for (const type of eventTypes) {
    const override = options.overrides?.[type];
    if (override) {
      builder.event(type, override);
    }
  }

  return builder.events(...eventTypes);
}

export function defineCommand<TName extends string, TInput, TOutput, TError = never>(
  name: TName,
  codecs: {
    readonly input: Codec<TInput>;
    readonly output: Codec<TOutput>;
    readonly error?: Codec<TError>;
  },
): CommandDefinition<TName, TInput, TOutput, TError> {
  return {
    name,
    input: codecs.input,
    output: codecs.output,
    error: codecs.error,
  };
}

export function toSessionId(value: string): SessionId {
  return value as SessionId;
}

export function toTurnId(value: string): TurnId {
  return value as TurnId;
}

export function toEventIndex(value: number): EventIndex {
  return value as EventIndex;
}

export function toIdempotencyKey(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}

export function toMessageId(value: string): MessageId {
  return value as MessageId;
}

export function toToolExecutionId(value: string): ToolExecutionId {
  return value as ToolExecutionId;
}
