import type {
  HarnessAdapterSubmitResponse,
  HarnessAdapterRunResponse,
  HarnessClientAdapter,
  HarnessContinueRequest,
  HarnessResultRequest,
  HarnessRunRequest,
  HarnessSubmitRequest,
  HarnessSessionCommandRequest,
  WireEventEnvelope,
} from "~/adapters/types";

export interface ORPCHarnessRouter {
  readonly run: (
    input: HarnessRunRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly submit: (
    input: HarnessSubmitRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterSubmitResponse>;
  readonly result: (
    input: HarnessResultRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly continue: (
    input: HarnessContinueRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<HarnessAdapterRunResponse>;
  readonly steer: (
    input: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<unknown>;
  readonly followUp: (
    input: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<unknown>;
  readonly cancel: (
    input: HarnessSessionCommandRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<unknown>;
  readonly events: (
    input: { readonly sessionId: string; readonly offset?: number },
    options?: { readonly signal?: AbortSignal },
  ) => AsyncIterable<WireEventEnvelope> | Promise<AsyncIterable<WireEventEnvelope>>;
}

export function createORPCAdapter<TClient extends ORPCHarnessRouter>(
  client: TClient,
): HarnessClientAdapter {
  return {
    run: (request, options) => client.run(request, options),
    submit: (request, options) => client.submit(request, options),
    result: (request, options) => client.result(request, options),
    continue: (request, options) => client.continue(request, options),
    steer: async (request, options) => {
      await client.steer(request, options);
    },
    followUp: async (request, options) => {
      await client.followUp(request, options);
    },
    cancel: async (request, options) => {
      await client.cancel(request, options);
    },
    events: (request, options) => {
      if (!request.sessionId) {
        throw new TypeError("oRPC adapter requires sessionId for events stream");
      }

      const stream = client.events(
        {
          sessionId: request.sessionId,
          offset: request.offset,
        },
        options,
      );

      return {
        async *[Symbol.asyncIterator]() {
          const resolved = await stream;
          for await (const event of resolved) {
            if (event.type === "__keepalive") {
              continue;
            }

            yield event;
          }
        },
      };
    },
  };
}
