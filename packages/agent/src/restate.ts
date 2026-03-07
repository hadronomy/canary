import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Serde } from "@restatedev/restate-sdk";
import { TerminalError, type Context, type RunOptions } from "@restatedev/restate-sdk";

import type { SessionApi } from "~/api";
import { defineCodec, SuperJsonCodec, type Codec } from "~/codec";
import type { DurableRuntime } from "~/durable";
import type { HarnessTurnRuntime } from "~/harness";
import type { AnyEventEnvelope, EventMap } from "~/protocol";

export class SuperJsonSerde<T> extends SuperJsonCodec<T> {}

export const superJson = new SuperJsonSerde<unknown>();

export function toRestateSerde<T>(codec: Codec<T>): Serde<T> {
  return codec.asSerde();
}

export function fromRestateSerde<T>(serde: Serde<T>): Codec<T, T> {
  return defineCodec({
    contentType: serde.contentType,
    jsonSchema: serde.jsonSchema,
    encode: (value) => value,
    decode: (value) => value as T,
    serialize: (value) => serde.serialize(value),
    deserialize: (data) => serde.deserialize(data),
  });
}

function getSuperJsonSerde<T>(): Serde<T> {
  return superJson as Serde<T>;
}

function hasNameAndCode(value: unknown): value is { readonly name: string; readonly code: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { readonly name?: unknown; readonly code?: unknown };
  const maybeName = candidate.name;
  const maybeCode = candidate.code;

  return typeof maybeName === "string" && typeof maybeCode === "number";
}

export function isTerminalError(err: unknown): boolean {
  if (err instanceof TerminalError) return true;

  if (!hasNameAndCode(err)) {
    return false;
  }

  return (
    (err.name === "TerminalError" && err.code !== undefined) ||
    (err.name === "TimeoutError" && err.code === 408) ||
    (err.name === "CancelledError" && err.code === 409)
  );
}

export function durableCalls(
  ctx: Context,
  opts?: {
    llm?: RunOptions<AssistantMessage>;
    tool?: RunOptions<unknown>;
    publish?: RunOptions<void>;
  },
) {
  const llmOptions: RunOptions<AssistantMessage> = {
    serde: getSuperJsonSerde<AssistantMessage>(),
    ...opts?.llm,
  };

  const toolOptions: RunOptions<unknown> = {
    serde: superJson,
    ...opts?.tool,
  };

  const publishOptions: RunOptions<void> = {
    ...opts?.publish,
  };

  return {
    runLlmFinal: (key: string, fn: () => Promise<AssistantMessage>) =>
      ctx.run(`llm:${key}`, fn, llmOptions),

    runTool: (key: string, fn: () => Promise<unknown>) => ctx.run(`tool:${key}`, fn, toolOptions),

    runPublish: (key: string, fn: () => Promise<void>) =>
      ctx.run(`publish:${key}`, fn, publishOptions),
  };
}

export interface CreateRestateDurableRuntimeOptions<TMap extends object = EventMap> {
  readonly state?: {
    readonly get?: <T>(key: string) => Promise<T | undefined>;
    readonly set?: <T>(key: string, value: T) => Promise<void>;
    readonly delete?: (key: string) => Promise<void>;
  };
  readonly publish?: (
    topic: string,
    event: AnyEventEnvelope<TMap>,
    idempotencyKey?: string,
  ) => Promise<void> | void;
}

export function createRestateDurableRuntime<TMap extends object = EventMap>(
  ctx: Context,
  options?: CreateRestateDurableRuntimeOptions<TMap>,
): DurableRuntime<TMap> {
  const fallbackState = new Map<string, unknown>();

  return {
    run: <T>(idempotencyKey: string, fn: () => Promise<T>) =>
      Promise.resolve(ctx.run(`run:${idempotencyKey}`, fn, { serde: getSuperJsonSerde<T>() })),
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (ms <= 0) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);

        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new Error("Sleep aborted"));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    state: {
      get: async <T>(key: string) =>
        (await options?.state?.get?.<T>(key)) ?? (fallbackState.get(key) as T | undefined),
      set: async <T>(key: string, value: T) => {
        fallbackState.set(key, value);
        await options?.state?.set?.(key, value);
      },
      delete: async (key: string) => {
        fallbackState.delete(key);
        await options?.state?.delete?.(key);
      },
    },
    sideEffect: <T>(name: string, fn: () => Promise<T>) =>
      Promise.resolve(ctx.run(`side-effect:${name}`, fn, { serde: getSuperJsonSerde<T>() })),
    pubsub: {
      publish: async (topic: string, event: AnyEventEnvelope<TMap>, idempotencyKey?: string) => {
        await options?.publish?.(topic, event, idempotencyKey);
      },
      subscribe: (_topic: string, _handler: (event: AnyEventEnvelope<TMap>) => void) => () => {},
    },
  };
}

export function createRestateTurnRuntime<
  TMap extends object = EventMap,
  TContext = unknown,
>(options: {
  readonly sessionApi: SessionApi<TMap, TContext>;
  readonly context: TContext;
}): HarnessTurnRuntime {
  return {
    submitTurn: (input) => options.sessionApi.submitTurn(input, options.context),
  };
}
