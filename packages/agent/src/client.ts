import type { AnyEventEnvelope, CommandDefinition, EventMap, EventRegistry } from "~/protocol";
import { decodeSseWithRegistry } from "~/stream";

type CommandMap = Record<string, CommandDefinition<string, unknown, unknown, unknown>>;

export type CommandInput<TCommand extends CommandDefinition<string, unknown, unknown, unknown>> =
  TCommand extends CommandDefinition<string, infer TInput, unknown, unknown> ? TInput : never;

export type CommandOutput<TCommand extends CommandDefinition<string, unknown, unknown, unknown>> =
  TCommand extends CommandDefinition<string, unknown, infer TOutput, unknown> ? TOutput : never;

/**
 * @deprecated Use `createHarnessClient` from `~/harness` for typed session-first APIs.
 */
export interface AgentLink<
  TMap extends object = EventMap,
  TCommands extends CommandMap = CommandMap,
> {
  readonly events: (options?: {
    readonly signal?: AbortSignal;
  }) => AsyncIterable<AnyEventEnvelope<TMap>>;
  readonly request: <TName extends keyof TCommands & string>(
    name: TName,
    input: CommandInput<TCommands[TName]>,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ) => Promise<CommandOutput<TCommands[TName]>>;
  readonly close?: () => Promise<void> | void;
}

/**
 * @deprecated Use `createHarnessClient` from `~/harness`.
 */
export function createAgentClient<
  TMap extends object = EventMap,
  TCommands extends CommandMap = CommandMap,
>(options: { readonly link: AgentLink<TMap, TCommands> }) {
  return {
    events: options.link.events,
    request: options.link.request,
    close: async () => {
      await options.link.close?.();
    },
  };
}

/**
 * @deprecated Use `CreateHarnessClientOptions` from `~/harness`.
 */
export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

/**
 * @deprecated Use `createHarnessClient` fetch override from `~/harness`.
 */
export interface FetchLike {
  (
    input: string | URL,
    init?: {
      readonly method?: string;
      readonly headers?: Record<string, string>;
      readonly body?: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<FetchLikeResponse>;
}

/**
 * @deprecated Use `createHarnessClient` event stream abstractions from `~/harness`.
 */
export interface EventSourceMessageLike {
  readonly data: string;
  readonly lastEventId: string;
  readonly type: string;
}

/**
 * @deprecated Use `createHarnessClient` event stream abstractions from `~/harness`.
 */
export interface EventSourceLike {
  onmessage: ((event: EventSourceMessageLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

/**
 * @deprecated Use `createHarnessClient` event stream abstractions from `~/harness`.
 */
export interface EventSourceFactory {
  (url: string): EventSourceLike;
}

/**
 * @deprecated Use `CreateHarnessClientOptions` + `createHarnessClient` from `~/harness`.
 */
export interface CreateSseClientOptions<
  TMap extends object = EventMap,
  TCommands extends CommandMap = CommandMap,
> {
  readonly eventsUrl: string | URL;
  readonly requestUrl: string | URL;
  readonly eventRegistry: EventRegistry<TMap>;
  readonly commands: TCommands;
  readonly fetch: FetchLike;
  readonly createEventSource?: EventSourceFactory;
  readonly resume?: {
    readonly getOffset?: () => number;
    readonly setOffset?: (offset: number) => void;
  };
}

function resolveUrl(url: string | URL, offset?: number): string {
  if (offset === undefined) {
    return url instanceof URL ? url.toString() : url;
  }

  const parsed = new URL(url instanceof URL ? url.toString() : url, "http://localhost");
  parsed.searchParams.set("offset", String(offset));
  if (url instanceof URL) {
    return parsed.toString();
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function getDefaultEventSourceFactory(): EventSourceFactory {
  const eventSourceCtor = (
    globalThis as { readonly EventSource?: new (url: string) => EventSourceLike }
  ).EventSource;

  if (!eventSourceCtor) {
    throw new TypeError(
      "No EventSource implementation available. Pass createEventSource explicitly.",
    );
  }

  return (url: string) => new eventSourceCtor(url);
}

function createQueue<T>() {
  const values: Array<T> = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let done = false;

  function next(): Promise<IteratorResult<T>> {
    if (values.length > 0) {
      const value = values.shift() as T;
      return Promise.resolve({ value, done: false });
    }

    if (done) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise<IteratorResult<T>>((resolve) => {
      waiters.push(resolve);
    });
  }

  function push(value: T): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    values.push(value);
  }

  function finish(): void {
    done = true;
    for (const waiter of waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  return { next, push, finish };
}

/**
 * @deprecated Use `createHarnessClient` from `~/harness`.
 */
export function createSseClient<
  TMap extends object = EventMap,
  TCommands extends CommandMap = CommandMap,
>(options: CreateSseClientOptions<TMap, TCommands>): AgentLink<TMap, TCommands> {
  const createEventSource = options.createEventSource ?? getDefaultEventSourceFactory();

  return {
    events(eventOptions) {
      const queue = createQueue<AnyEventEnvelope<TMap>>();
      const offset = options.resume?.getOffset?.();
      const url = resolveUrl(options.eventsUrl, offset);
      const source = createEventSource(url);

      source.onmessage = (message) => {
        const frame = {
          id: message.lastEventId || undefined,
          event: message.type || undefined,
          data: message.data,
        };

        const envelope = decodeSseWithRegistry(frame, options.eventRegistry);
        options.resume?.setOffset?.(Number(envelope.index) + 1);
        queue.push(envelope);
      };

      source.onerror = () => {
        source.close();
        queue.finish();
      };

      eventOptions?.signal?.addEventListener("abort", () => {
        source.close();
        queue.finish();
      });

      return {
        [Symbol.asyncIterator]() {
          return {
            next: queue.next,
          };
        },
      };
    },

    async request<TName extends keyof TCommands & string>(
      name: TName,
      input: CommandInput<TCommands[TName]>,
      requestOptions?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
    ): Promise<CommandOutput<TCommands[TName]>> {
      const command = options.commands[name];
      if (!command) {
        throw new TypeError(`Unknown command '${name}'`);
      }

      const body = JSON.stringify({
        command: name,
        input: command.input.encode(input),
      });

      const response = await options.fetch(options.requestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body,
        signal: requestOptions?.signal,
      });

      if (!response.ok) {
        throw new TypeError(`Command request '${name}' failed with status ${response.status}`);
      }

      const payload = await response.json();
      return command.output.decode(payload) as CommandOutput<TCommands[TName]>;
    },

    close() {
      return Promise.resolve();
    },
  };
}

type RouterHandler<
  TContext,
  TCommand extends CommandDefinition<string, unknown, unknown, unknown>,
> = (
  input: CommandInput<TCommand>,
  context: TContext,
) => Promise<CommandOutput<TCommand>> | CommandOutput<TCommand>;

type RouterHandlers<TCommands extends CommandMap, TContext> = Partial<{
  [TName in keyof TCommands]: RouterHandler<TContext, TCommands[TName]>;
}>;

export interface CommandRouter<
  TCommands extends CommandMap,
  TContext,
  THandlers extends RouterHandlers<TCommands, TContext>,
> {
  readonly handle: <TName extends keyof TCommands & string>(
    name: TName,
    handler: RouterHandler<TContext, TCommands[TName]>,
  ) => CommandRouter<
    TCommands,
    TContext,
    THandlers & Record<TName, RouterHandler<TContext, TCommands[TName]>>
  >;
  readonly execute: <TName extends keyof TCommands & string>(
    name: TName,
    input: CommandInput<TCommands[TName]>,
    context: TContext,
  ) => Promise<CommandOutput<TCommands[TName]>>;
  readonly handlers: THandlers;
}

export function createCommandRouter<TCommands extends CommandMap, TContext = unknown>(options: {
  readonly commands: TCommands;
}): CommandRouter<TCommands, TContext, {}> {
  function makeRouter<THandlers extends RouterHandlers<TCommands, TContext>>(
    handlers: THandlers,
  ): CommandRouter<TCommands, TContext, THandlers> {
    return {
      handle(name, handler) {
        return makeRouter({
          ...handlers,
          [name]: handler,
        } as THandlers & Record<typeof name, RouterHandler<TContext, TCommands[typeof name]>>);
      },
      async execute(name, input, context) {
        const handler = handlers[name];
        if (!handler) {
          throw new TypeError(`No handler registered for command '${name}'`);
        }

        const command = options.commands[name];
        if (!command) {
          throw new TypeError(`Unknown command '${name}'`);
        }

        const decodedInput = command.input.decode(command.input.encode(input)) as CommandInput<
          TCommands[typeof name]
        >;
        const output = await handler(decodedInput, context);
        return command.output.decode(command.output.encode(output)) as CommandOutput<
          TCommands[typeof name]
        >;
      },
      handlers,
    };
  }

  return makeRouter({});
}
