import type { AnyEventEnvelope, EventMap } from "~/protocol";

export interface DurableRuntimeState {
  readonly get: <T>(key: string) => Promise<T | undefined>;
  readonly set: <T>(key: string, value: T) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

export interface DurableRuntimePubsub<TMap extends object = EventMap> {
  readonly publish: (
    topic: string,
    event: AnyEventEnvelope<TMap>,
    idempotencyKey?: string,
  ) => Promise<void>;
  readonly subscribe: (
    topic: string,
    handler: (event: AnyEventEnvelope<TMap>) => void,
  ) => () => void;
}

export interface DurableRuntime<TMap extends object = EventMap> {
  readonly run: <T>(idempotencyKey: string, fn: () => Promise<T>) => Promise<T>;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly state: DurableRuntimeState;
  readonly sideEffect: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  readonly pubsub: DurableRuntimePubsub<TMap>;
}

export interface CreateMemoryDurableRuntimeOptions<TMap extends object = EventMap> {
  readonly dedupe?: boolean;
  readonly onPublish?: (
    topic: string,
    event: AnyEventEnvelope<TMap>,
    idempotencyKey?: string,
  ) => void;
}

export function createMemoryDurableRuntime<TMap extends object = EventMap>(
  options?: CreateMemoryDurableRuntimeOptions<TMap>,
): DurableRuntime<TMap> {
  const values = new Map<string, unknown>();
  const runCache = new Map<string, unknown>();
  const subscribers = new Map<string, Set<(event: AnyEventEnvelope<TMap>) => void>>();

  function getSubscribers(topic: string): Set<(event: AnyEventEnvelope<TMap>) => void> {
    const current = subscribers.get(topic);
    if (current) {
      return current;
    }

    const created = new Set<(event: AnyEventEnvelope<TMap>) => void>();
    subscribers.set(topic, created);
    return created;
  }

  return {
    async run<T>(idempotencyKey: string, fn: () => Promise<T>): Promise<T> {
      if (options?.dedupe !== false && runCache.has(idempotencyKey)) {
        return runCache.get(idempotencyKey) as T;
      }

      const value = await fn();
      if (options?.dedupe !== false) {
        runCache.set(idempotencyKey, value);
      }
      return value;
    },
    async sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async delete(key: string): Promise<void> {
        values.delete(key);
      },
    },
    async sideEffect<T>(_name: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    pubsub: {
      async publish(
        topic: string,
        event: AnyEventEnvelope<TMap>,
        idempotencyKey?: string,
      ): Promise<void> {
        options?.onPublish?.(topic, event, idempotencyKey);
        for (const handler of getSubscribers(topic)) {
          handler(event);
        }
      },
      subscribe(topic: string, handler: (event: AnyEventEnvelope<TMap>) => void): () => void {
        const topicSubscribers = getSubscribers(topic);
        topicSubscribers.add(handler);

        return () => {
          topicSubscribers.delete(handler);
          if (topicSubscribers.size === 0) {
            subscribers.delete(topic);
          }
        };
      },
    },
  };
}
