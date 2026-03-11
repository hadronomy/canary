import { ORPCError, os, withEventMeta } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { createPubsubClient } from '@restatedev/pubsub-client';
import { z } from 'zod';

import {
  codec,
  defineEventRegistryFromMap,
  type AnyEventEnvelope,
  type EventMap,
} from '@canary/agent';

import { createOrchestratorClient } from './shared';

interface AuthContext {
  readonly userId: string;
  readonly token: string;
}

interface RequestContext {
  readonly request: Request;
  readonly url: URL;
}

const authToken = process.env.EXAMPLE_AGENT_API_TOKEN ?? 'dev-token';
const debugStreaming = (process.env.EXAMPLE_AGENT_DEBUG_STREAMING ?? 'false') === 'true';
const restateIngressUrl = (process.env.RESTATE_INGRESS_URL ?? 'http://127.0.0.1:8080').replace(
  /\/$/,
  '',
);
const pubsubName = process.env.RESTATE_PUBSUB_NAME ?? 'pubsub';
const orchestrator = createOrchestratorClient({ baseUrl: restateIngressUrl });
const pubsubClient = createPubsubClient({
  url: restateIngressUrl,
  name: pubsubName,
  pullInterval: {
    milliseconds: 10,
  },
});
const eventRegistry = defineEventRegistryFromMap({ defaultCodec: codec.superJson });
const sessionOwners = new Map<string, string>();

interface WireEnvelope {
  readonly type: string;
  readonly index: number;
  readonly turnId: string;
  readonly sessionId: string;
  readonly ts: string;
  readonly payload: unknown;
}

function toWireEnvelope(message: unknown, fallbackSessionId: string): WireEnvelope | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const candidate = message as Partial<AnyEventEnvelope<EventMap>>;
  if (typeof candidate.type !== 'string') {
    return undefined;
  }

  const eventType = candidate.type as keyof EventMap;
  const definition = eventRegistry[eventType];
  if (!definition) {
    return undefined;
  }

  const eventIndex = Number(candidate.index);
  if (!Number.isFinite(eventIndex) || eventIndex < 0) {
    return undefined;
  }

  const payload = (() => {
    const payloadCandidate: unknown = candidate.payload;

    if (typeof payloadCandidate === 'string') {
      return payloadCandidate;
    }

    return codec.superJson.encode(payloadCandidate);
  })();

  return {
    type: candidate.type,
    index: eventIndex,
    turnId: String(candidate.turnId ?? ''),
    sessionId: String(candidate.sessionId ?? fallbackSessionId),
    ts: String(candidate.ts ?? new Date().toISOString()),
    payload,
  };
}

const runResponseSchema = z.object({
  output: z.unknown(),
  turnId: z.string(),
  nextIndex: z.number(),
});

const runSubmitInputSchema = z.object({
  sessionId: z.string(),
  idempotencyKey: z.string(),
  agent: z.string(),
  input: z.string(),
});

const submitResponseSchema = z.object({
  turnId: z.string(),
});

const sessionCommandResultSchema = z.object({
  ok: z.boolean(),
});

function ensureSessionAccess(sessionId: string, userId: string): void {
  const owner = sessionOwners.get(sessionId);
  if (!owner) {
    sessionOwners.set(sessionId, userId);
    return;
  }

  if (owner !== userId) {
    throw new Error(`Session '${sessionId}' belongs to a different user`);
  }
}

const pub = os.$context<RequestContext>().use(({ context, next }) => {
  const header = context.request.headers.get('authorization');
  const bearerToken = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : undefined;
  const queryToken = context.url.searchParams.get('token') ?? undefined;
  const token = bearerToken ?? queryToken;

  if (!token) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Missing bearer token',
    });
  }

  if (token.length === 0 || token !== authToken) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Invalid bearer token',
    });
  }

  const userId =
    context.request.headers.get('x-user-id') ??
    context.url.searchParams.get('userId') ??
    'demo-user';

  return next({
    context: {
      userId,
      token,
    } satisfies AuthContext,
  });
});

export const appRouter = pub.router({
  run: pub
    .input(runSubmitInputSchema)
    .output(runResponseSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      return orchestrator.call(
        input.sessionId,
        'run',
        {
          ...input,
          context: {
            userId: context.userId,
          },
        },
        { idempotencyKey: input.idempotencyKey, signal },
      );
    }),

  submit: pub
    .input(runSubmitInputSchema)
    .output(submitResponseSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      return orchestrator.call(
        input.sessionId,
        'submit',
        {
          ...input,
          context: {
            userId: context.userId,
          },
        },
        { idempotencyKey: input.idempotencyKey, signal },
      );
    }),

  result: pub
    .input(
      z.object({
        sessionId: z.string(),
        turnId: z.string(),
        agent: z.string(),
      }),
    )
    .output(runResponseSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      return orchestrator.call(input.sessionId, 'result', input, { signal });
    }),

  continue: pub
    .input(
      z.object({
        sessionId: z.string(),
        idempotencyKey: z.string(),
        agent: z.string(),
      }),
    )
    .output(runResponseSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      return orchestrator.call(input.sessionId, 'continue', input, {
        idempotencyKey: input.idempotencyKey,
        signal,
      });
    }),

  steer: pub
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().optional(),
      }),
    )
    .output(sessionCommandResultSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      await orchestrator.call(input.sessionId, 'steer', input, { signal });
      return { ok: true };
    }),

  followUp: pub
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().optional(),
      }),
    )
    .output(sessionCommandResultSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      await orchestrator.call(input.sessionId, 'followUp', input, { signal });
      return { ok: true };
    }),

  cancel: pub
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string().optional(),
      }),
    )
    .output(sessionCommandResultSchema)
    .handler(async ({ input, context, signal }) => {
      ensureSessionAccess(input.sessionId, context.userId);
      await orchestrator.call(input.sessionId, 'cancel', input, { signal });
      return { ok: true };
    }),

  events: pub
    .input(
      z.object({
        sessionId: z.string(),
        offset: z.number().optional(),
      }),
    )
    .handler(async function* ({ input, context, signal, lastEventId }) {
      ensureSessionAccess(input.sessionId, context.userId);
      let nextOffset =
        typeof lastEventId === 'string' && lastEventId.length > 0
          ? Number(lastEventId) + 1
          : (input.offset ?? 0);
      if (!Number.isFinite(nextOffset) || nextOffset < 0) {
        nextOffset = input.offset ?? 0;
      }

      const stream = pubsubClient.pull({
        topic: input.sessionId,
        offset: nextOffset,
        signal,
      });

      for await (const message of stream) {
        const envelope = toWireEnvelope(message, input.sessionId);
        if (!envelope) {
          continue;
        }

        const eventIndex = envelope.index;

        if (debugStreaming) {
          const nowIso = new Date().toISOString();
          const lagMs =
            envelope.ts && !Number.isNaN(Date.parse(envelope.ts))
              ? Date.now() - Date.parse(envelope.ts)
              : undefined;
          console.log(
            `[edge-stream][${nowIso}] session=${input.sessionId} idx=${eventIndex} type=${envelope.type} eventTs=${envelope.ts ?? 'n/a'} lagMs=${lagMs ?? 'n/a'}`,
          );
        }

        yield withEventMeta(envelope, {
          id: String(eventIndex),
        });

        nextOffset = eventIndex + 1;
      }
    }),
});

export type AppRouter = typeof appRouter;
const rpcHandler = new RPCHandler(appRouter);

Bun.serve({
  port: 3000,
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);
    const result = await rpcHandler.handle(request, {
      context: {
        request,
        url,
      },
    });

    if (result.matched) {
      return result.response;
    }

    return new Response('Not found', { status: 404 });
  },
});
