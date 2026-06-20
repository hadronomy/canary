import { snakeCamelMapper } from '@electric-sql/client';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { createCollection } from '@tanstack/react-db';
import { z } from 'zod';

const stamp = z.string().or(z.date());

export const threadSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  createdAt: stamp,
  updatedAt: stamp,
  archivedAt: stamp.nullable(),
});

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  ownerId: z.string(),
  runId: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const runSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  ownerId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed']),
  model: z.string(),
  error: z.string().nullable(),
  startedAt: stamp.nullable(),
  completedAt: stamp.nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const eventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  ownerId: z.string(),
  seq: z.number(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: stamp,
});

export type Thread = z.infer<typeof threadSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Run = z.infer<typeof runSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Tx = { txid: number };

export function threads(opts: { base?: string; archive: (input: { id: string }) => Promise<Tx> }) {
  const base = opts.base ?? '/api/sync';

  return createCollection(
    electricCollectionOptions({
      id: 'threads',
      schema: threadSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${base}/threads`,
        columnMapper: snakeCamelMapper(),
      },
      syncMode: 'eager',
      onUpdate: async ({ transaction }) => {
        const item = transaction.mutations[0]?.original;

        if (!item) {
          return;
        }

        return await opts.archive({ id: item.id });
      },
    }),
  );
}

export function messages(opts: {
  base?: string;
  threadId: string;
  send: (input: { content: string; id: string; threadId: string }) => Promise<Tx>;
}) {
  const base = opts.base ?? '/api/sync';

  return createCollection(
    electricCollectionOptions({
      id: `messages:${opts.threadId}`,
      schema: messageSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${base}/messages?threadId=${encodeURIComponent(opts.threadId)}`,
        columnMapper: snakeCamelMapper(),
      },
      syncMode: 'eager',
      onInsert: async ({ transaction }) => {
        const item = transaction.mutations[0]?.modified;

        if (!item) {
          return;
        }

        return await opts.send({
          id: item.id,
          threadId: item.threadId,
          content: item.content,
        });
      },
    }),
  );
}

export function runs(opts: { base?: string; threadId: string }) {
  const base = opts.base ?? '/api/sync';

  return createCollection(
    electricCollectionOptions({
      id: `runs:${opts.threadId}`,
      schema: runSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${base}/runs?threadId=${encodeURIComponent(opts.threadId)}`,
        columnMapper: snakeCamelMapper(),
      },
      syncMode: 'eager',
    }),
  );
}

export function events(opts: { base?: string; threadId: string }) {
  const base = opts.base ?? '/api/sync';

  return createCollection(
    electricCollectionOptions({
      id: `events:${opts.threadId}`,
      schema: eventSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${base}/events?threadId=${encodeURIComponent(opts.threadId)}`,
        columnMapper: snakeCamelMapper(),
      },
      syncMode: 'eager',
    }),
  );
}
