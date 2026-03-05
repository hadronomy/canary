import type { Codec } from "~/codec";
import type {
  AnyEventEnvelope,
  EventIndex,
  EventEnvelope,
  EventMap,
  EventRegistry,
  SessionId,
  TurnId,
  EventType,
} from "~/protocol";
import { toEventIndex, toSessionId, toTurnId } from "~/protocol";

export interface SseEventFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

export interface SseEncodeOptions {
  readonly index?: EventIndex | number;
  readonly turnId?: TurnId | string;
}

export interface SseSessionOptions {
  readonly startIndex?: EventIndex | number;
  readonly turnId?: TurnId | string;
}

export interface CreateSseServerOptions<TMap extends object = EventMap> {
  readonly eventRegistry: EventRegistry<TMap>;
  readonly now?: () => string;
}

export interface SseServerSession<TMap extends object = EventMap> {
  readonly sessionId: SessionId;
  readonly currentIndex: EventIndex;
  readonly event: <TType extends EventType<TMap>>(
    type: TType,
    payload: TMap[TType],
    options?: SseEncodeOptions,
  ) => string;
  readonly envelope: <TType extends EventType<TMap>>(
    type: TType,
    payload: TMap[TType],
    options?: SseEncodeOptions,
  ) => EventEnvelope<TMap, TType>;
  readonly keepalive: (data?: string) => string;
  readonly comment: (text: string) => string;
}

export interface SseServer<TMap extends object = EventMap> {
  readonly decode: (frame: SseEventFrame) => AnyEventEnvelope<TMap>;
  readonly encodeRaw: (frame: SseEventFrame) => string;
  readonly keepalive: (data?: string) => string;
  readonly comment: (text: string) => string;
  readonly session: (
    sessionId: SessionId | string,
    options?: SseSessionOptions,
  ) => SseServerSession<TMap>;
}

export function encodeSseRaw(frame: SseEventFrame): string {
  const lines = [
    frame.id ? `id: ${frame.id}` : undefined,
    frame.event ? `event: ${frame.event}` : undefined,
    ...frame.data.split("\n").map((line) => `data: ${line}`),
  ].filter((line) => line !== undefined);

  return `${lines.join("\n")}\n\n`;
}

function encodeRawComment(comment: string): string {
  return comment
    .split("\n")
    .map((line) => `: ${line}`)
    .join("\n")
    .concat("\n\n");
}

function normalizeSessionId(sessionId: SessionId | string): SessionId {
  return typeof sessionId === "string" ? toSessionId(sessionId) : sessionId;
}

function normalizeTurnId(turnId: TurnId | string | undefined): TurnId | undefined {
  if (turnId === undefined) {
    return undefined;
  }

  return typeof turnId === "string" ? toTurnId(turnId) : turnId;
}

function normalizeEventIndex(index: EventIndex | number): EventIndex {
  return typeof index === "number" ? toEventIndex(index) : index;
}

export function encodeSse<TMap extends object, TType extends EventType<TMap>>(
  envelope: EventEnvelope<TMap, TType>,
  codec: Codec<EventEnvelope<TMap, TType>>,
): string {
  const encodedPayload = codec.encode(envelope);
  const payload = JSON.stringify(encodedPayload);

  return encodeSseRaw({
    id: String(envelope.index),
    event: envelope.type,
    data: payload,
  });
}

export function decodeSse<TMap extends object, TType extends EventType<TMap>>(
  frame: SseEventFrame,
  type: TType,
  codec: Codec<EventEnvelope<TMap, TType>>,
): EventEnvelope<TMap, TType> {
  const data = JSON.parse(frame.data) as unknown;
  const decoded = codec.decode(data);

  if (decoded.type !== type) {
    throw new TypeError(`decodeSse received event type '${decoded.type}' but expected '${type}'`);
  }

  return decoded;
}

export function decodeSseWithRegistry<TMap extends object = EventMap>(
  frame: SseEventFrame,
  registry: EventRegistry<TMap>,
): AnyEventEnvelope<TMap> {
  if (!frame.event) {
    throw new TypeError("SSE frame is missing 'event' value");
  }

  const eventType = frame.event as EventType<TMap>;
  const eventDefinition = registry[eventType];
  if (!eventDefinition) {
    throw new TypeError(`Unknown event type '${frame.event}'`);
  }

  const rawData = JSON.parse(frame.data) as unknown;
  if (typeof rawData !== "object" || rawData === null) {
    throw new TypeError("SSE data must be an object envelope");
  }

  const wireEnvelope = rawData as {
    readonly index?: number;
    readonly sessionId?: string;
    readonly turnId?: string;
    readonly ts?: string;
    readonly payload?: unknown;
  };

  if (typeof wireEnvelope.sessionId !== "string") {
    throw new TypeError("SSE envelope is missing a valid sessionId");
  }

  const payload = eventDefinition.codec.decode(wireEnvelope.payload);

  const index = Number(frame.id ?? wireEnvelope.index ?? -1);
  if (!Number.isFinite(index) || index < 0) {
    throw new TypeError(`Invalid SSE id '${frame.id ?? ""}'`);
  }

  return {
    index: toEventIndex(index),
    sessionId: toSessionId(wireEnvelope.sessionId),
    turnId: wireEnvelope.turnId ? toTurnId(wireEnvelope.turnId) : undefined,
    type: eventType,
    ts: wireEnvelope.ts ?? new Date().toISOString(),
    payload,
    schemaVersion: 1,
  } as AnyEventEnvelope<TMap>;
}

export function createSseServer<TMap extends object = EventMap>(
  options: CreateSseServerOptions<TMap>,
): SseServer<TMap> {
  const now = options.now ?? (() => new Date().toISOString());

  function encodeEnvelope<TType extends EventType<TMap>>(
    envelope: EventEnvelope<TMap, TType>,
  ): string {
    const definition = options.eventRegistry[envelope.type];
    if (!definition) {
      throw new TypeError(`Unknown event type '${envelope.type}'`);
    }

    const wireEnvelope = {
      index: envelope.index,
      sessionId: envelope.sessionId,
      turnId: envelope.turnId,
      ts: envelope.ts,
      payload: definition.codec.encode(envelope.payload),
    };

    return encodeSseRaw({
      id: String(envelope.index),
      event: envelope.type,
      data: JSON.stringify(wireEnvelope),
    });
  }

  function makeSession(
    sessionIdValue: SessionId | string,
    sessionOptions?: SseSessionOptions,
  ): SseServerSession<TMap> {
    const sessionId = normalizeSessionId(sessionIdValue);
    let nextIndex = normalizeEventIndex(sessionOptions?.startIndex ?? 0);
    const defaultTurnId = normalizeTurnId(sessionOptions?.turnId);

    function reserveIndex(override?: EventIndex | number): EventIndex {
      if (override !== undefined) {
        return normalizeEventIndex(override);
      }

      const current = nextIndex;
      nextIndex = toEventIndex(Number(current) + 1);
      return current;
    }

    function envelope<TType extends EventType<TMap>>(
      type: TType,
      payload: TMap[TType],
      encodeOptions?: SseEncodeOptions,
    ): EventEnvelope<TMap, TType> {
      return {
        index: reserveIndex(encodeOptions?.index),
        sessionId,
        turnId: normalizeTurnId(encodeOptions?.turnId) ?? defaultTurnId,
        type,
        ts: now(),
        payload,
        schemaVersion: 1,
      };
    }

    return {
      sessionId,
      get currentIndex() {
        return nextIndex;
      },
      event(type, payload, encodeOptions) {
        return encodeEnvelope(envelope(type, payload, encodeOptions));
      },
      envelope,
      keepalive(data = "{}") {
        return encodeSseRaw({ event: "keepalive", data });
      },
      comment(text) {
        return encodeRawComment(text);
      },
    };
  }

  return {
    decode(frame) {
      return decodeSseWithRegistry(frame, options.eventRegistry);
    },
    encodeRaw: encodeSseRaw,
    keepalive(data = "{}") {
      return encodeSseRaw({ event: "keepalive", data });
    },
    comment(text) {
      return encodeRawComment(text);
    },
    session: makeSession,
  };
}
