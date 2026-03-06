import { codec, createSseServer, defineEventRegistryFromMap } from "@canary/agent";
import type { AnyEventEnvelope, EventMap } from "@canary/agent";

interface AuthContext {
  readonly userId: string;
  readonly token: string;
}

interface RunBody {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
  readonly input: {
    readonly question: string;
  };
}

interface ContinueBody {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly agent: string;
}

interface SessionCommandBody {
  readonly sessionId: string;
  readonly content?: string;
}

interface HistoryQuery {
  readonly sessionId: string;
  readonly offset?: number;
}

const authToken = process.env.EXAMPLE_AGENT_API_TOKEN ?? "dev-token";
const sessionOwners = new Map<string, string>();
const restateIngressUrl = (process.env.RESTATE_INGRESS_URL ?? "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const orchestratorService = "agent-orchestrator";
const sse = createSseServer({
  eventRegistry: defineEventRegistryFromMap({
    defaultCodec: codec.superJson,
  }),
});

function unauthorized(message = "Unauthorized"): Response {
  return new Response(message, {
    status: 401,
    headers: {
      "www-authenticate": 'Bearer realm="agent-example"',
    },
  });
}

function forbidden(message = "Forbidden"): Response {
  return new Response(message, { status: 403 });
}

function extractAuthContext(request: Request, url: URL): AuthContext | Response {
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : undefined;
  const queryToken = url.searchParams.get("token") ?? undefined;
  const token = bearerToken ?? queryToken;

  if (!token) {
    return unauthorized("Missing bearer token");
  }

  if (token.length === 0 || token !== authToken) {
    return unauthorized("Invalid bearer token");
  }

  const userId = request.headers.get("x-user-id") ?? url.searchParams.get("userId") ?? "demo-user";
  return {
    userId,
    token,
  };
}

function ensureSessionAccess(sessionId: string, userId: string): Response | null {
  const owner = sessionOwners.get(sessionId);
  if (!owner) {
    sessionOwners.set(sessionId, userId);
    return null;
  }

  if (owner !== userId) {
    return forbidden(`Session '${sessionId}' belongs to a different user`);
  }

  return null;
}

function toIngressUrl(sessionId: string, handler: string): string {
  return `${restateIngressUrl}/${orchestratorService}/${encodeURIComponent(sessionId)}/${handler}`;
}

async function callOrchestrator<T>(
  sessionId: string,
  handler: string,
  body: unknown,
  options?: {
    readonly idempotencyKey?: string;
    readonly signal?: AbortSignal;
  },
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options?.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  const response = await fetch(toIngressUrl(sessionId, handler), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Orchestrator ${handler} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

function createEventsProxyStream(options: {
  readonly sessionId: string;
  readonly offset?: number;
  readonly signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let nextOffset = options.offset ?? 0;
  const sseSession = sse.session(options.sessionId);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let inFlight = false;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        controller.close();
      };

      const tick = async () => {
        if (closed || inFlight) {
          return;
        }

        inFlight = true;
        try {
          const events = await callOrchestrator<ReadonlyArray<AnyEventEnvelope<EventMap>>>(
            options.sessionId,
            "getEvents",
            {
              sessionId: options.sessionId,
              offset: nextOffset,
            },
            { signal: options.signal },
          );

          for (const event of events) {
            controller.enqueue(
              encoder.encode(
                sseSession.event(event.type, event.payload, {
                  index: event.index,
                  turnId: event.turnId,
                }),
              ),
            );
            nextOffset = Number(event.index) + 1;
          }
        } catch {
          close();
        } finally {
          inFlight = false;
        }
      };

      controller.enqueue(encoder.encode(": connected\n\n"));
      const interval = setInterval(() => void tick(), 500);
      void tick();

      options.signal.addEventListener("abort", () => {
        clearInterval(interval);
        close();
      });
    },
  });
}

Bun.serve({
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url);
    const auth = extractAuthContext(request, url);
    if (auth instanceof Response) {
      return auth;
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const body = (await request.json()) as RunBody;
      const denial = ensureSessionAccess(body.sessionId, auth.userId);
      if (denial) {
        return denial;
      }

      const payload = await callOrchestrator(
        body.sessionId,
        "run",
        {
          ...body,
          context: {
            userId: auth.userId,
          },
        },
        {
          idempotencyKey: body.idempotencyKey,
          signal: request.signal,
        },
      );

      return Response.json(payload);
    }

    if (url.pathname === "/continue" && request.method === "POST") {
      const body = (await request.json()) as ContinueBody;
      const denial = ensureSessionAccess(body.sessionId, auth.userId);
      if (denial) {
        return denial;
      }

      const payload = await callOrchestrator(body.sessionId, "continue", body, {
        idempotencyKey: body.idempotencyKey,
        signal: request.signal,
      });
      return Response.json(payload);
    }

    if (url.pathname === "/events" && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response("sessionId query param is required", { status: 400 });
      }

      const denial = ensureSessionAccess(sessionId, auth.userId);
      if (denial) {
        return denial;
      }

      const offsetRaw = url.searchParams.get("offset");
      const offset = offsetRaw ? Number(offsetRaw) : undefined;
      const stream = createEventsProxyStream({
        sessionId,
        offset,
        signal: request.signal,
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (url.pathname === "/history" && request.method === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response("sessionId query param is required", { status: 400 });
      }

      const denial = ensureSessionAccess(sessionId, auth.userId);
      if (denial) {
        return denial;
      }

      const offsetRaw = url.searchParams.get("offset");
      const offset = offsetRaw ? Number(offsetRaw) : undefined;
      const query: HistoryQuery = {
        sessionId,
        offset,
      };

      const events = await callOrchestrator<ReadonlyArray<AnyEventEnvelope<EventMap>>>(
        sessionId,
        "getEvents",
        query,
        { signal: request.signal },
      );

      return Response.json(events);
    }

    if (
      (url.pathname === "/steer" || url.pathname === "/follow-up" || url.pathname === "/cancel") &&
      request.method === "POST"
    ) {
      const body = (await request.json()) as SessionCommandBody;
      const denial = ensureSessionAccess(body.sessionId, auth.userId);
      if (denial) {
        return denial;
      }

      const handler =
        url.pathname === "/follow-up" ? "followUp" : url.pathname === "/steer" ? "steer" : "cancel";

      await callOrchestrator(body.sessionId, handler, body, { signal: request.signal });
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
});
