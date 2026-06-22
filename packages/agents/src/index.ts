import type { ChunkType } from '@mastra/core/stream';

import { Agent } from '@mastra/core/agent';
import { createEventedAgent } from '@mastra/core/agent/durable';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

import { env } from '@canary/env/server';

import { PostgresCache } from './cache';

export type Chat = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
};

export type Input = {
  messages: Chat[];
  ownerId: string;
  runId: string;
  threadId: string;
  piece: (part: Piece) => Promise<void> | void;
  finish: (text: string, data: Record<string, unknown>) => Promise<void> | void;
  fail: (err: Error) => Promise<void> | void;
};

export type Piece =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; text: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-call'; id: string; name: string; data: Record<string, unknown> }
  | { type: 'tool-delta'; id: string; name: string | null; text: string }
  | { type: 'tool-result'; id: string; name: string; data: Record<string, unknown> }
  | { type: 'error'; message: string };

export const store = new PostgresStore({
  id: 'canary-agents',
  connectionString: env.DATABASE_URL,
});

export const memory = new Memory({
  storage: store,
  vector: false,
  options: {
    lastMessages: 24,
    workingMemory: {
      enabled: true,
      scope: 'thread',
    },
  },
});

export const agent = new Agent({
  id: 'canary-agent',
  name: 'Canary Agent',
  instructions:
    'You are Canary, a precise and fast coding agent. Keep answers direct, preserve user intent, and call tools only when they are useful.',
  model: {
    providerId: 'openrouter',
    modelId: env.AGENT_MODEL,
    url: 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY,
    headers: {
      'HTTP-Referer': env.BETTER_AUTH_URL,
      'X-Title': 'Canary',
    },
  },
  memory,
});

export const durable = createEventedAgent({
  agent,
  cache: new PostgresCache(),
  maxSteps: 12,
});

export async function stream(input: Input) {
  const last = input.messages.at(-1)?.content ?? '';

  if (!env.OPENROUTER_API_KEY) {
    await fallback(input, last);
    return input.runId;
  }

  const res = await durable.stream(last, {
    runId: input.runId,
    memory: {
      thread: input.threadId,
      resource: input.ownerId,
    },
    onChunk: async (chunk) => {
      const part = piece(chunk);

      if (part) {
        await input.piece(part);
      }
    },
    onFinish: async (data) => {
      await input.finish(data.output.text ?? '', {
        reason: data.stepResult.reason,
        usage: data.output.usage,
      });
    },
    onError: input.fail,
  });

  return res.runId;
}

async function fallback(input: Input, last: string) {
  const text = `I received your message and queued the durable agent path. Configure OPENROUTER_API_KEY to let Mastra call ${env.AGENT_MODEL} through OpenRouter. Last input: ${last}`;

  await input.piece({ type: 'text-start', id: 'fallback' });
  await text
    .split(/(\s+)/)
    .filter(Boolean)
    .reduce(async (prev, item) => {
      await prev;
      await input.piece({ type: 'text-delta', id: 'fallback', text: item });
    }, Promise.resolve());
  await input.piece({ type: 'text-end', id: 'fallback' });
  await input.finish(text, { reason: 'fallback', usage: null });
}

function piece(chunk: ChunkType): Piece | null {
  switch (chunk.type) {
    case 'text-start':
      return { type: 'text-start', id: chunk.payload.id };
    case 'text-delta':
      return { type: 'text-delta', id: chunk.payload.id, text: chunk.payload.text };
    case 'text-end':
      return { type: 'text-end', id: chunk.payload.id };
    case 'reasoning-start':
      return { type: 'reasoning-start', id: chunk.payload.id };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', id: chunk.payload.id, text: chunk.payload.text };
    case 'reasoning-end':
      return { type: 'reasoning-end', id: chunk.payload.id };
    case 'tool-call':
      return {
        type: 'tool-call',
        id: chunk.payload.toolCallId,
        name: chunk.payload.toolName,
        data: {
          args: chunk.payload.args ?? null,
          providerExecuted: chunk.payload.providerExecuted ?? false,
        },
      };
    case 'tool-call-delta':
      return {
        type: 'tool-delta',
        id: chunk.payload.toolCallId,
        name: chunk.payload.toolName ?? null,
        text: chunk.payload.argsTextDelta,
      };
    case 'tool-result':
      return {
        type: 'tool-result',
        id: chunk.payload.toolCallId,
        name: chunk.payload.toolName,
        data: {
          result: chunk.payload.result,
          isError: chunk.payload.isError ?? false,
        },
      };
    case 'error':
      return { type: 'error', message: error(chunk.payload.error) };
    default:
      return null;
  }
}

function error(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}
