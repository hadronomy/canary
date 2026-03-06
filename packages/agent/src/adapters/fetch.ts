import type {
  CreateFetchHarnessAdapterOptions,
  HarnessClientAdapter,
  HarnessClientResolvedUrls,
  HarnessFetch,
  HarnessFetchInit,
  HarnessFetchResponse,
  HarnessRouteName,
  WireEventEnvelope,
} from "~/adapters/types";
import { CLIENT_ERROR_CODE } from "~/errors";

const harnessDefaultRoutes: Record<HarnessRouteName, string> = {
  run: "/run",
  continue: "/continue",
  events: "/events",
  steer: "/steer",
  followUp: "/follow-up",
  cancel: "/cancel",
};

function resolveEventUrl(
  base: string | URL,
  options?: {
    readonly offset?: number;
    readonly sessionId?: string;
    readonly queryParams?: Record<string, string>;
  },
): string {
  const offset = options?.offset;
  const sessionId = options?.sessionId;
  const queryParams = options?.queryParams;

  if (offset === undefined && sessionId === undefined && !queryParams) {
    return base instanceof URL ? base.toString() : base;
  }

  const parsed = new URL(base instanceof URL ? base.toString() : base, "http://localhost");
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      parsed.searchParams.set(key, value);
    }
  }
  if (offset !== undefined) {
    parsed.searchParams.set("offset", String(offset));
  }
  if (sessionId !== undefined) {
    parsed.searchParams.set("sessionId", sessionId);
  }

  if (base instanceof URL) {
    return parsed.toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return parsed.toString();
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function resolveCommandUrl(
  base: string | URL,
  override: string | URL | undefined,
  suffix: string,
): string {
  if (override) {
    return override instanceof URL ? override.toString() : override;
  }

  const normalizedSuffix = suffix.replace(/^\/+/, "");

  const applySiblingPath = (url: URL): URL => {
    const currentPath = url.pathname;
    const parentPath =
      currentPath.endsWith("/") || currentPath.length === 0
        ? currentPath
        : currentPath.slice(0, currentPath.lastIndexOf("/") + 1);
    const joined = `${parentPath}${normalizedSuffix}`.replace(/\/{2,}/g, "/");

    const next = new URL(url.toString());
    next.pathname = joined.startsWith("/") ? joined : `/${joined}`;
    return next;
  };

  if (base instanceof URL) {
    return applySiblingPath(base).toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    return applySiblingPath(new URL(base)).toString();
  }

  const parsed = new URL(base, "http://localhost");
  const resolved = applySiblingPath(parsed);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function resolvePathFromBase(base: string | URL, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const joinPath = (basePath: string): string => {
    const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
    return `${prefix}${normalizedPath}`.replace(/\/{2,}/g, "/");
  };

  if (base instanceof URL) {
    const next = new URL(base.toString());
    next.pathname = joinPath(next.pathname);
    return next.toString();
  }

  if (base.startsWith("http://") || base.startsWith("https://")) {
    const next = new URL(base);
    next.pathname = joinPath(next.pathname);
    return next.toString();
  }

  const parsed = new URL(base, "http://localhost");
  const next = new URL(parsed.toString());
  next.pathname = joinPath(next.pathname);
  return `${next.pathname}${next.search}${next.hash}`;
}

function resolveClientUrls(options: CreateFetchHarnessAdapterOptions): HarnessClientResolvedUrls {
  if (options.baseUrl !== undefined) {
    const routes = options.routes;
    return {
      run: resolvePathFromBase(options.baseUrl, routes?.run ?? harnessDefaultRoutes.run),
      continue: resolvePathFromBase(
        options.baseUrl,
        routes?.continue ?? harnessDefaultRoutes.continue,
      ),
      events: resolvePathFromBase(options.baseUrl, routes?.events ?? harnessDefaultRoutes.events),
      steer: resolvePathFromBase(options.baseUrl, routes?.steer ?? harnessDefaultRoutes.steer),
      followUp: resolvePathFromBase(
        options.baseUrl,
        routes?.followUp ?? harnessDefaultRoutes.followUp,
      ),
      cancel: resolvePathFromBase(options.baseUrl, routes?.cancel ?? harnessDefaultRoutes.cancel),
    };
  }

  if (!options.runUrl || !options.eventsUrl) {
    throw new TypeError(
      "createFetchHarnessAdapter requires either baseUrl, or both runUrl and eventsUrl for configuration.",
    );
  }

  const continueUrl =
    options.continueUrl !== undefined
      ? resolveCommandUrl(options.runUrl, options.continueUrl, "/continue")
      : options.runUrl instanceof URL
        ? options.runUrl.toString()
        : options.runUrl;

  return {
    run: options.runUrl instanceof URL ? options.runUrl.toString() : options.runUrl,
    continue: continueUrl,
    events: options.eventsUrl instanceof URL ? options.eventsUrl.toString() : options.eventsUrl,
    steer: resolveCommandUrl(options.runUrl, options.steerUrl, "/steer"),
    followUp: resolveCommandUrl(options.runUrl, options.followUpUrl, "/follow-up"),
    cancel: resolveCommandUrl(options.runUrl, options.cancelUrl, "/cancel"),
  };
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
      const value = items.shift();
      if (value === undefined) {
        return Promise.resolve({ value: undefined, done: true });
      }

      return Promise.resolve({ value, done: false });
    }

    if (done) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
  }

  return { push, close, next };
}

function normalizeHeaders(headers?: RequestInit["headers"]): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized = new Headers(headers);
  const result: Record<string, string> = {};
  normalized.forEach((value, key) => {
    result[key] = value;
  });

  return result;
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

function parseWireEvent(message: {
  readonly data: string;
  readonly lastEventId: string;
  readonly type: string;
}): WireEventEnvelope {
  const rawData = JSON.parse(message.data) as unknown;
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

  const index = Number((message.lastEventId || wireEnvelope.index) ?? -1);
  if (!Number.isFinite(index) || index < 0) {
    throw new TypeError(`Invalid SSE id '${message.lastEventId}'`);
  }

  return {
    type: message.type,
    index,
    sessionId: wireEnvelope.sessionId,
    turnId: wireEnvelope.turnId,
    ts: wireEnvelope.ts,
    payload: wireEnvelope.payload,
  };
}

function ensureRunResponse(payload: unknown): {
  readonly output: unknown;
  readonly turnId: string;
  readonly nextIndex: number;
} {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Invalid run response: expected object");
  }

  const candidate = payload as {
    readonly output?: unknown;
    readonly turnId?: unknown;
    readonly nextIndex?: unknown;
    readonly nextOffset?: unknown;
  };

  if (typeof candidate.turnId !== "string") {
    throw new TypeError("Invalid run response: missing turnId");
  }

  const nextIndexValue =
    typeof candidate.nextIndex === "number"
      ? candidate.nextIndex
      : typeof candidate.nextOffset === "number"
        ? candidate.nextOffset
        : undefined;

  if (nextIndexValue === undefined || !Number.isFinite(nextIndexValue)) {
    throw new TypeError("Invalid run response: missing nextIndex");
  }

  return {
    output: candidate.output,
    turnId: candidate.turnId,
    nextIndex: nextIndexValue,
  };
}

export function createFetchHarnessAdapter(
  options: CreateFetchHarnessAdapterOptions,
): HarnessClientAdapter {
  const createEventSource = options.createEventSource ?? defaultEventSourceFactory();
  const urls = resolveClientUrls(options);
  const requestQueryParams = options.queryParams;
  const sseQueryParams = options.sseOptions?.().queryParams;
  const eventQueryParams = {
    ...requestQueryParams,
    ...sseQueryParams,
  };

  const defaultFetch: HarnessFetch = async (input, init) => {
    const response = await fetch(typeof input === "string" ? input : input.toString(), {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      json: <T>() => response.json() as Promise<T>,
      text: () => response.text(),
    };
  };

  const fetcher: HarnessFetch = options.fetch ?? defaultFetch;

  async function request(
    input: string | URL,
    init?: HarnessFetchInit,
  ): Promise<HarnessFetchResponse> {
    const requestDefaults = (await options.fetchOptions?.()) ?? {};
    const signal = init?.signal ?? undefined;
    return fetcher(resolveEventUrl(input, { queryParams: requestQueryParams }), {
      ...requestDefaults,
      ...init,
      headers: {
        ...normalizeHeaders(requestDefaults.headers),
        ...normalizeHeaders(init?.headers),
      },
      signal,
    });
  }

  async function sendSessionCommand(
    url: string,
    body: { readonly sessionId: string; readonly content?: string },
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new TypeError(
        `${CLIENT_ERROR_CODE.HARNESS_HTTP_SESSION_COMMAND_FAILED}: status ${response.status}`,
      );
    }
  }

  return {
    async run(requestOptions, signalOptions) {
      const response = await request(urls.run, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...requestOptions,
          intent: "run",
        }),
        signal: signalOptions?.signal,
      });

      if (!response.ok) {
        throw new TypeError(
          `${CLIENT_ERROR_CODE.HARNESS_HTTP_RUN_FAILED}: status ${response.status}`,
        );
      }

      return ensureRunResponse(await response.json());
    },

    async continue(requestOptions, signalOptions) {
      const response = await request(urls.continue, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...requestOptions,
          intent: "continue",
        }),
        signal: signalOptions?.signal,
      });

      if (!response.ok) {
        throw new TypeError(
          `${CLIENT_ERROR_CODE.HARNESS_HTTP_RUN_FAILED}: status ${response.status}`,
        );
      }

      return ensureRunResponse(await response.json());
    },

    steer: (commandOptions, signalOptions) =>
      sendSessionCommand(urls.steer, commandOptions, signalOptions?.signal),

    followUp: (commandOptions, signalOptions) =>
      sendSessionCommand(urls.followUp, commandOptions, signalOptions?.signal),

    cancel: (commandOptions, signalOptions) =>
      sendSessionCommand(urls.cancel, commandOptions, signalOptions?.signal),

    events(eventOptions, signalOptions) {
      const queue = createQueue<WireEventEnvelope>();
      const streamUrl = resolveEventUrl(urls.events, {
        offset: eventOptions.offset,
        sessionId: eventOptions.sessionId,
        queryParams: eventQueryParams,
      });
      const source = createEventSource(streamUrl);

      source.onmessage = (message) => {
        queue.push(parseWireEvent(message));
      };

      const close = () => {
        source.close();
        queue.close();
      };

      source.onerror = close;
      signalOptions?.signal?.addEventListener("abort", close, { once: true });

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
