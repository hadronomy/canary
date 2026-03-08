import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Serde } from "@restatedev/restate-sdk";
import {
  TerminalError,
  type Context,
  type ObjectContext,
  type ObjectSharedContext,
  type RunOptions,
} from "@restatedev/restate-sdk";

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
  ctx: ObjectContext | ObjectSharedContext,
  options?: CreateRestateDurableRuntimeOptions<TMap>,
): DurableRuntime<TMap> {
  const signalWaitersPrefix = "signal:waiters:";
  const signalResolvedPrefix = "signal:resolved:";

  function signalWaitersKey(key: string): string {
    return `${signalWaitersPrefix}${key}`;
  }

  function signalResolvedKey(key: string): string {
    return `${signalResolvedPrefix}${key}`;
  }

  async function getSignalWaiters(key: string): Promise<Array<string>> {
    const waiters = await ctx.get<Array<string>>(
      signalWaitersKey(key),
      getSuperJsonSerde<Array<string>>(),
    );
    return waiters ?? [];
  }

  async function getResolvedSignalValue<T>(key: string): Promise<T | undefined> {
    const value = await ctx.get<T>(signalResolvedKey(key), getSuperJsonSerde<T>());
    return value ?? undefined;
  }

  function canMutateState(value: ObjectContext | ObjectSharedContext): value is ObjectContext {
    return "set" in value && "clear" in value;
  }

  function ensureMutableContext(operation: string): ObjectContext {
    if (!canMutateState(ctx)) {
      throw new Error(`${operation} requires ObjectContext state mutation access`);
    }

    return ctx;
  }

  return {
    run: <T>(idempotencyKey: string, fn: () => Promise<T>) =>
      Promise.resolve(ctx.run(`run:${idempotencyKey}`, fn, { serde: getSuperJsonSerde<T>() })),
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (ms <= 0) {
        return;
      }
      if (!signal) {
        await ctx.sleep(ms);
        return;
      }

      if (signal.aborted) {
        throw signal.reason ?? new Error("Sleep aborted");
      }

      await Promise.race([
        ctx.sleep(ms),
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(signal.reason ?? new Error("Sleep aborted"));
            },
            { once: true },
          );
        }),
      ]);
    },
    state: {
      get: async <T>(key: string) => {
        if (options?.state?.get) {
          return options.state.get<T>(key);
        }

        const value = await ctx.get<T>(key, getSuperJsonSerde<T>());
        return value ?? undefined;
      },
      set: async <T>(key: string, value: T) => {
        if (options?.state?.set) {
          await options.state.set<T>(key, value);
          return;
        }

        ensureMutableContext("state.set").set<T>(key, value, getSuperJsonSerde<T>());
      },
      delete: async (key: string) => {
        if (options?.state?.delete) {
          await options.state.delete(key);
          return;
        }

        ensureMutableContext("state.delete").clear(key);
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
    rand: {
      uuid: () => ctx.rand.uuidv4(),
    },
    signals: {
      forKey: <T>(key: string) => {
        return {
          wait: async (): Promise<T> => {
            const resolved = await getResolvedSignalValue<T>(key);
            if (resolved !== undefined) {
              if (canMutateState(ctx)) {
                ctx.clear(signalResolvedKey(key));
              }
              return resolved;
            }

            const mutableCtx = ensureMutableContext("signals.wait");
            const awakeable = mutableCtx.awakeable<T>(getSuperJsonSerde<T>());
            const waiters = await getSignalWaiters(key);
            mutableCtx.set(
              signalWaitersKey(key),
              [...waiters, awakeable.id],
              getSuperJsonSerde<Array<string>>(),
            );
            try {
              return await awakeable.promise;
            } finally {
              const currentWaiters = await getSignalWaiters(key);
              const remaining = currentWaiters.filter((waiterId) => waiterId !== awakeable.id);
              mutableCtx.set(signalWaitersKey(key), remaining, getSuperJsonSerde<Array<string>>());
            }
          },
          resolve: async (value: T): Promise<void> => {
            const waiters = await getSignalWaiters(key);

            if (canMutateState(ctx)) {
              ctx.set(signalResolvedKey(key), value, getSuperJsonSerde<T>());
            }

            for (const waiterId of waiters) {
              ctx.resolveAwakeable(waiterId, value, getSuperJsonSerde<T>());
            }

            if (canMutateState(ctx)) {
              ctx.clear(signalWaitersKey(key));
            }
          },
          reject: async (reason: string): Promise<void> => {
            const waiters = await getSignalWaiters(key);
            for (const waiterId of waiters) {
              ctx.rejectAwakeable(waiterId, reason);
            }

            if (canMutateState(ctx)) {
              ctx.clear(signalWaitersKey(key));
            }
          },
          peek: async (): Promise<T | undefined> => {
            return await getResolvedSignalValue<T>(key);
          },
        };
      },
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
