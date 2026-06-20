import { env } from '@canary/env/server';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

export type Chat = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
};

export type Reply = {
  messages: Chat[];
  ownerId: string;
  runId: string;
  threadId: string;
};

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
  model: env.AGENT_MODEL,
  memory,
});

export async function reply(input: Reply) {
  const last = input.messages.at(-1)?.content ?? '';

  if (!env.OPENAI_API_KEY) {
    return `I received your message and queued the agent path. Configure OPENAI_API_KEY to let Mastra call ${env.AGENT_MODEL}. Last input: ${last}`;
  }

  const res = await agent.generate(last, {
    runId: input.runId,
    memory: {
      thread: input.threadId,
      resource: input.ownerId,
    },
  });

  return res.text;
}
