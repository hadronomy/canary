import type { AnyEventEnvelope, EventMap } from '~/protocol';

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

export interface DurableSignal<T> {
  readonly wait: () => Promise<T>;
  readonly resolve: (value: T) => Promise<void>;
  readonly reject: (reason: string) => Promise<void>;
  readonly peek?: () => Promise<T | undefined>;
}

export interface DurableRuntimeRand {
  readonly uuid: () => string;
}

export interface DurableRuntimeSignals {
  readonly forKey: <T>(key: string) => DurableSignal<T>;
}

export interface DurableRuntime<TMap extends object = EventMap> {
  readonly run: <T>(idempotencyKey: string, fn: () => Promise<T>) => Promise<T>;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly state: DurableRuntimeState;
  readonly sideEffect: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  readonly pubsub: DurableRuntimePubsub<TMap>;
  readonly rand: DurableRuntimeRand;
  readonly signals: DurableRuntimeSignals;
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
  type SignalSettled =
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly reason: string };
  type SignalWaiter = {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
  };
  const signalState = new Map<
    string,
    {
      settled?: SignalSettled;
      waiters: Array<SignalWaiter>;
    }
  >();

  function getSubscribers(topic: string): Set<(event: AnyEventEnvelope<TMap>) => void> {
    const current = subscribers.get(topic);
    if (current) {
      return current;
    }

    const created = new Set<(event: AnyEventEnvelope<TMap>) => void>();
    subscribers.set(topic, created);
    return created;
  }

  function getSignalEntry(key: string): {
    settled?: SignalSettled;
    waiters: Array<SignalWaiter>;
  } {
    const existing = signalState.get(key);
    if (existing) {
      return existing;
    }

    const created = {
      waiters: [],
    };
    signalState.set(key, created);
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
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);

        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason ?? new Error('Sleep aborted'));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
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
    rand: {
      uuid: () => crypto.randomUUID(),
    },
    signals: {
      forKey: <T>(key: string): DurableSignal<T> => {
        return {
          wait: async (): Promise<T> => {
            const entry = getSignalEntry(key);
            if (entry.settled) {
              if (entry.settled.ok) {
                return entry.settled.value as T;
              }

              throw new Error(entry.settled.reason);
            }

            return await new Promise<T>((resolve, reject) => {
              entry.waiters.push({
                resolve: (value) => {
                  resolve(value as T);
                },
                reject,
              });
            });
          },
          resolve: async (value: T): Promise<void> => {
            const entry = getSignalEntry(key);
            entry.settled = { ok: true, value };
            const waiters = entry.waiters.splice(0);
            for (const waiter of waiters) {
              waiter.resolve(value);
            }
          },
          reject: async (reason: string): Promise<void> => {
            const entry = getSignalEntry(key);
            entry.settled = { ok: false, reason };
            const waiters = entry.waiters.splice(0);
            for (const waiter of waiters) {
              waiter.reject(new Error(reason));
            }
          },
          peek: async (): Promise<T | undefined> => {
            const entry = getSignalEntry(key);
            if (!entry.settled || !entry.settled.ok) {
              return undefined;
            }

            return entry.settled.value as T;
          },
        };
      },
    },
  };
}
