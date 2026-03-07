import type { EventMap } from "~/protocol";

export interface WireEventEnvelope {
  readonly type: string;
  readonly index: number;
  readonly turnId?: string;
  readonly sessionId?: string;
  readonly ts?: string;
  readonly payload: unknown;
}

export interface HarnessRunRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
  readonly input: unknown;
}

export interface HarnessSubmitRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
  readonly input: unknown;
}

export interface HarnessContinueRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
}

export interface HarnessAdapterRunResponse {
  readonly output: unknown;
  readonly turnId: string;
  readonly nextIndex: number;
}

export interface HarnessAdapterSubmitResponse {
  readonly turnId: string;
}

export interface HarnessResultRequest {
  readonly sessionId: string;
  readonly turnId: string;
  readonly agent: string;
}

export interface HarnessSessionCommandRequest {
  readonly sessionId: string;
  readonly content?: string;
}

export interface HarnessClientAdapter {
  readonly run: (
    request: HarnessRunRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly submit: (
    request: HarnessSubmitRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterSubmitResponse>;
  readonly result: (
    request: HarnessResultRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly continue: (
    request: HarnessContinueRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly steer: (
    request: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  readonly followUp: (
    request: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  readonly cancel: (
    request: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  readonly events: (
    request: { readonly sessionId?: string; readonly offset?: number },
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<WireEventEnvelope>;
}

export type HarnessFetchInit = {
  readonly method?: RequestInit["method"];
  readonly headers?: RequestInit["headers"];
  readonly body?: RequestInit["body"];
  readonly signal?: AbortSignal;
} & Omit<RequestInit, "method" | "headers" | "body" | "signal">;

export type HarnessFetchOptions = Omit<HarnessFetchInit, "method" | "body" | "signal">;

export type HarnessFetchResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: <T>() => Promise<T>;
  readonly text: () => Promise<string>;
};

export type HarnessFetch = (
  input: string | URL,
  init?: HarnessFetchInit,
) => Promise<HarnessFetchResponse>;

export interface HarnessEventSourceMessage {
  readonly data: string;
  readonly lastEventId: string;
  readonly type: string;
}

export interface HarnessEventSource {
  onmessage: ((event: HarnessEventSourceMessage) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close: () => void;
}

export interface HarnessEventSourceFactory {
  (url: string): HarnessEventSource;
}

export type HarnessClientRoutes = {
  readonly run?: string;
  readonly submit?: string;
  readonly result?: string;
  readonly continue?: string;
  readonly events?: string;
  readonly steer?: string;
  readonly followUp?: string;
  readonly cancel?: string;
};

export type HarnessRouteName =
  | "run"
  | "submit"
  | "result"
  | "continue"
  | "events"
  | "steer"
  | "followUp"
  | "cancel";

export type HarnessClientResolvedUrls = Record<HarnessRouteName, string>;

export interface CreateFetchHarnessAdapterOptions {
  readonly baseUrl?: string | URL;
  readonly routes?: HarnessClientRoutes;
  readonly eventsUrl?: string | URL;
  readonly runUrl?: string | URL;
  readonly submitUrl?: string | URL;
  readonly resultUrl?: string | URL;
  readonly continueUrl?: string | URL;
  readonly steerUrl?: string | URL;
  readonly followUpUrl?: string | URL;
  readonly cancelUrl?: string | URL;
  readonly queryParams?: Record<string, string>;
  readonly fetch?: HarnessFetch;
  readonly fetchOptions?: () => HarnessFetchOptions | Promise<HarnessFetchOptions>;
  readonly sseOptions?: () => {
    readonly queryParams?: Record<string, string>;
  };
  readonly createEventSource?: HarnessEventSourceFactory;
}

export type WireEventType<TType extends keyof EventMap & string> = {
  readonly type: TType;
  readonly payload: unknown;
};
