import type { DurableAgenticWorkflowInput } from '@mastra/core/agent/durable';
import type { ChunkType } from '@mastra/core/stream';

import { Agent } from '@mastra/core/agent';
import { EventedAgent } from '@mastra/core/agent/durable';
import { RequestContext } from '@mastra/core/request-context';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { z } from 'zod';

import { ENV } from '@canary/agents/env';

import { PostgresCache } from './cache';

export type Chat = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
};

export type Input = {
  messages: readonly Chat[];
  /** OpenRouter slug of the model this run answers with. */
  model: string;
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
  | { type: 'tool-result'; id: string; name: string; data: Record<string, unknown> };

export const store = new PostgresStore({
  id: 'canary-agents',
  connectionString: ENV.DATABASE_URL,
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

/**
 * What each run hands the agent: the OpenRouter model it answers with.
 *
 * Parsed where it is read rather than declared as the agent's
 * `requestContextSchema`: Mastra's durable wrapper takes an agent whose
 * context is untyped, so a typed one does not fit it. Parsing gives the same
 * guarantee — a missing or empty model fails before anything is sent to
 * OpenRouter.
 */
const Context = z.object({ model: z.string().min(1) });
type Context = z.infer<typeof Context>;

export const agent = new Agent({
  id: 'canary-agent',
  name: 'Canary Agent',
  instructions: `You are Canary, a precise and fast coding agent.

Preserve the user's requested order of operations.

When a task needs a tool:
1. If you are going to say anything before the tool call, say it before calling the tool.
2. Call the tool immediately after that pre-tool text.
3. After the tool result, continue with post-tool text.
4. Never say that you are about to call a tool after the tool has already completed.
5. Do not narrate tool use unless it helps the user understand what is happening.

Keep answers direct.`,
  // Each run names its own model, the thread's, carried here on the request
  // context. There is no default to fall back to on purpose: when Mastra
  // resumes a run in another process it asks with an empty context, and a
  // default here would quietly answer with a different model. Failing instead
  // lets Mastra fall back to the model it saved with the run.
  model: ({ requestContext }) => {
    const { model } = Context.parse({ model: requestContext.get('model') });

    return {
      providerId: 'openrouter',
      modelId: model,
      url: 'https://openrouter.ai/api/v1',
      apiKey: ENV.OPENROUTER_API_KEY,
      headers: {
        'HTTP-Referer': ENV.BETTER_AUTH_URL,
        'X-Title': 'Canary',
      },
    };
  },
  memory,
});

class CanaryAgent extends EventedAgent {
  private readonly runs = new Map<string, { cancel: () => Promise<void> }>();
  private readonly stopped = new Set<string>();

  protected override async executeWorkflow(id: string, input: DurableAgenticWorkflowInput) {
    const run = await this.getWorkflow().createRun({ runId: id, pubsub: this.pubsubInternal });
    this.runs.set(id, run);

    if (this.stopped.has(id)) {
      await run.cancel();
      this.runs.delete(id);
      this.stopped.delete(id);
      return;
    }

    await run.startAsync({
      inputData: input,
      requestContext: this.runRegistryInternal.get(id)?.requestContext,
    });
  }

  async cancel(id: string) {
    this.stopped.add(id);
    const run = this.runs.get(id);

    if (run) {
      await run.cancel();
      this.stopped.delete(id);
      return;
    }

    const pending = await this.getWorkflow().createRun({
      runId: id,
      pubsub: this.pubsub,
    });
    await pending.cancel();
  }

  forget(id: string) {
    this.runs.delete(id);
  }

  complete(id: string) {
    this.runs.delete(id);
    this.stopped.delete(id);
  }
}

export const durable = new CanaryAgent({
  agent,
  cache: new PostgresCache(),
  maxSteps: 12,
});

export async function open(input: Input) {
  const last = input.messages.at(-1)?.content ?? '';

  if (!ENV.OPENROUTER_API_KEY) {
    await fallback(input, last);
    return { runId: input.runId, cleanup() {} };
  }

  const context = new RequestContext<Context>();
  context.set('model', input.model);

  const res = await durable.stream(last, {
    runId: input.runId,
    requestContext: context,
    memory: {
      thread: input.threadId,
      resource: input.ownerId,
    },
    onChunk: async (chunk) => {
      if (chunk.type === 'error') {
        await input.fail(toError(chunk.payload.error));
        return;
      }

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
      durable.complete(input.runId);
    },
    onError: async (err) => {
      await input.fail(toError(err));
      durable.complete(input.runId);
    },
  });

  return {
    runId: res.runId,
    cleanup() {
      res.cleanup();
      durable.forget(input.runId);
    },
  };
}

export async function cancel(id: string) {
  await durable.cancel(id);
}

async function fallback(input: Input, last: string) {
  const text = `I received your message and queued the durable agent path. Configure OPENROUTER_API_KEY to let Mastra call ${input.model} through OpenRouter. Last input: ${last}`;

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
    default:
      return null;
  }
}

function toError(value: unknown) {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)));
}
