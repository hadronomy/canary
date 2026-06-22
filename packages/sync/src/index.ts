import type { PersistedCollectionPersistence } from '@tanstack/browser-db-sqlite-persistence';
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection';

import { FetchError, snakeCamelMapper } from '@electric-sql/client';
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence';
import { BasicIndex, createCollection } from '@tanstack/db';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { z } from 'zod';

const stamp = z.iso.datetime({ offset: true });
const pg = {
  timestamp: time,
  timestamptz: time,
};

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
  inputMessageId: z.string().nullable(),
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

export const partSchema = z.object({
  id: z.string(),
  messageId: z.string().nullable(),
  runId: z.string(),
  threadId: z.string(),
  ownerId: z.string(),
  seq: z.number(),
  kind: z.enum(['text', 'reasoning', 'tool-call', 'tool-result', 'artifact', 'error', 'status']),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  toolName: z.string().nullable(),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export type Thread = z.infer<typeof threadSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Run = z.infer<typeof runSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Part = z.infer<typeof partSchema>;
export type Tx = { txid: number };
type Base = { base: string };
type Scope = Base & { ownerId: string };

const lists = new Map<string, ReturnType<typeof makeThreads>>();
const texts = new Map<string, ReturnType<typeof makeMessages>>();
const rns = new Map<string, ReturnType<typeof makeRuns>>();
const evs = new Map<string, ReturnType<typeof makeEvents>>();
const pts = new Map<string, ReturnType<typeof makeParts>>();
const version = 5;
const ns = `canary-sync-v${version}`;
let disk: PersistedCollectionPersistence | null | undefined;
let boot: Promise<void> | undefined;

export function setup() {
  if (disk || boot) {
    return boot ?? Promise.resolve();
  }

  boot = openBrowserWASQLiteOPFSDatabase({
    databaseName: `${ns}.sqlite`,
  })
    .then((db) => {
      disk = createBrowserWASQLitePersistence({ database: db });
    })
    .catch((err: unknown) => {
      console.warn('TanStack DB persistence unavailable; using memory collections.', err);
      disk = null;
    });

  return boot;
}

export function threads(
  opts: Scope & {
    archive: (input: { id: string }) => Promise<Tx>;
    create: (input: { id: string; title: string }) => Promise<Tx>;
  },
) {
  const key = scope(opts);
  const hit = lists.get(key);

  if (hit) {
    return hit;
  }

  const col = makeThreads(opts);
  lists.set(key, col);

  return col;
}

function makeThreads(
  opts: Scope & {
    archive: (input: { id: string }) => Promise<Tx>;
    create: (input: { id: string; title: string }) => Promise<Tx>;
  },
) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:threads`,
    schema: threadSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: url(opts.base, 'threads'),
      columnMapper: snakeCamelMapper(),
      parser: pg,
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
    onInsert: async ({ transaction }) => {
      const rows = transaction.mutations
        .map((item) => item.modified)
        .filter((item) => item.ownerId === opts.ownerId && item.archivedAt == null);

      if (!rows.length) {
        return;
      }

      const res = await Promise.all(
        rows.map((item) => opts.create({ id: item.id, title: item.title })),
      );

      return {
        txid: res.map((item) => item.txid),
      };
    },
    onUpdate: async ({ transaction }) => {
      const rows = transaction.mutations.filter((item) => item.changes.archivedAt != null);

      if (!rows.length) {
        return;
      }

      const res = await Promise.all(rows.map((item) => opts.archive({ id: item.original.id })));

      return {
        txid: res.map((item) => item.txid),
      };
    },
  });

  const store = storage();

  if (store) {
    const res = persistedCollectionOptions<
      Thread,
      string | number,
      typeof threadSchema,
      ElectricCollectionUtils<Thread>
    >({
      ...cfg,
      persistence: store,
      schemaVersion: version,
    });

    const col = createCollection({
      ...res,
      schema: threadSchema,
    });

    col.createIndex((row) => row.updatedAt, { indexType: BasicIndex });

    return col;
  }

  const col = createCollection(cfg);

  col.createIndex((row) => row.updatedAt, { indexType: BasicIndex });

  return col;
}

export function messages(opts: {
  base: string;
  ownerId: string;
  send: (input: { content: string; id: string; threadId: string }) => Promise<Tx>;
}) {
  const key = scope(opts);
  const hit = texts.get(key);

  if (hit) {
    return hit;
  }

  const col = makeMessages(opts);
  texts.set(key, col);

  return col;
}

function makeMessages(opts: {
  base: string;
  ownerId: string;
  send: (input: { content: string; id: string; threadId: string }) => Promise<Tx>;
}) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:messages`,
    schema: messageSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: url(opts.base, 'messages'),
      columnMapper: snakeCamelMapper(),
      parser: pg,
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
    onInsert: async ({ transaction }) => {
      const rows = transaction.mutations
        .map((item) => item.modified)
        .filter(
          (item) => item.ownerId === opts.ownerId && item.role === 'user' && item.runId == null,
        );

      if (!rows.length) {
        return;
      }

      const res = await Promise.all(
        rows.map((item) =>
          opts.send({
            id: item.id,
            threadId: item.threadId,
            content: item.content,
          }),
        ),
      );

      return {
        txid: res.map((item) => item.txid),
      };
    },
  });

  const store = storage();

  if (store) {
    const res = persistedCollectionOptions<
      Message,
      string | number,
      typeof messageSchema,
      ElectricCollectionUtils<Message>
    >({
      ...cfg,
      persistence: store,
      schemaVersion: version,
    });

    const col = createCollection({
      ...res,
      schema: messageSchema,
    });

    col.createIndex((row) => row.createdAt, { indexType: BasicIndex });
    col.createIndex((row) => row.threadId, { indexType: BasicIndex });

    return col;
  }

  const col = createCollection(cfg);

  col.createIndex((row) => row.createdAt, { indexType: BasicIndex });
  col.createIndex((row) => row.threadId, { indexType: BasicIndex });

  return col;
}

export function runs(opts: Scope) {
  const key = scope(opts);
  const hit = rns.get(key);

  if (hit) {
    return hit;
  }

  const col = makeRuns(opts);
  rns.set(key, col);

  return col;
}

function makeRuns(opts: Scope) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:runs`,
    schema: runSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: url(opts.base, 'runs'),
      columnMapper: snakeCamelMapper(),
      parser: pg,
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
  });

  const store = storage();

  if (store) {
    const res = persistedCollectionOptions<
      Run,
      string | number,
      typeof runSchema,
      ElectricCollectionUtils<Run>
    >({
      ...cfg,
      persistence: store,
      schemaVersion: version,
    });

    const col = createCollection({
      ...res,
      schema: runSchema,
    });

    col.createIndex((row) => row.updatedAt, { indexType: BasicIndex });

    return col;
  }

  const col = createCollection(cfg);

  col.createIndex((row) => row.updatedAt, { indexType: BasicIndex });
  col.createIndex((row) => row.threadId, { indexType: BasicIndex });

  return col;
}

export function events(opts: Scope) {
  const key = scope(opts);
  const hit = evs.get(key);

  if (hit) {
    return hit;
  }

  const col = makeEvents(opts);
  evs.set(key, col);

  return col;
}

function makeEvents(opts: Scope) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:events`,
    schema: eventSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: url(opts.base, 'events'),
      columnMapper: snakeCamelMapper(),
      parser: pg,
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
  });

  const store = storage();

  if (store) {
    const res = persistedCollectionOptions<
      Event,
      string | number,
      typeof eventSchema,
      ElectricCollectionUtils<Event>
    >({
      ...cfg,
      persistence: store,
      schemaVersion: version,
    });

    const col = createCollection({
      ...res,
      schema: eventSchema,
    });

    col.createIndex((row) => row.seq, { indexType: BasicIndex });
    col.createIndex((row) => row.threadId, { indexType: BasicIndex });

    return col;
  }

  const col = createCollection(cfg);

  col.createIndex((row) => row.seq, { indexType: BasicIndex });
  col.createIndex((row) => row.threadId, { indexType: BasicIndex });

  return col;
}

export function parts(opts: Scope) {
  const key = scope(opts);
  const hit = pts.get(key);

  if (hit) {
    return hit;
  }

  const col = makeParts(opts);
  pts.set(key, col);

  return col;
}

function makeParts(opts: Scope) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:parts`,
    schema: partSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: url(opts.base, 'parts'),
      columnMapper: snakeCamelMapper(),
      parser: pg,
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
  });

  const store = storage();

  if (store) {
    const res = persistedCollectionOptions<
      Part,
      string | number,
      typeof partSchema,
      ElectricCollectionUtils<Part>
    >({
      ...cfg,
      persistence: store,
      schemaVersion: version,
    });

    const col = createCollection({
      ...res,
      schema: partSchema,
    });

    col.createIndex((row) => row.seq, { indexType: BasicIndex });
    col.createIndex((row) => row.threadId, { indexType: BasicIndex });
    col.createIndex((row) => row.runId, { indexType: BasicIndex });

    return col;
  }

  const col = createCollection(cfg);

  col.createIndex((row) => row.seq, { indexType: BasicIndex });
  col.createIndex((row) => row.threadId, { indexType: BasicIndex });
  col.createIndex((row) => row.runId, { indexType: BasicIndex });

  return col;
}

function storage() {
  if (disk === undefined) {
    throw new Error('TanStack DB persistence has not been initialized. Await setup() first.');
  }

  return disk;
}

function scope(opts: Scope) {
  return `${hash(opts.base)}:${opts.ownerId}`;
}

function hash(value: string) {
  return [...value]
    .reduce((sum, char) => {
      return Math.imul(sum ^ char.charCodeAt(0), 16_777_619) >>> 0;
    }, 2_166_136_261)
    .toString(36);
}

function url(base: string, path: string) {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

function time(value: string) {
  const text = value.replace(' ', 'T');

  if (/[+-]\d{2}$/.test(text)) {
    return `${text}:00`;
  }

  if (/[+-]\d{4}$/.test(text)) {
    return `${text.slice(0, -2)}:${text.slice(-2)}`;
  }

  if (/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return text;
  }

  return `${text}Z`;
}

function retry(err: Error) {
  if (err instanceof FetchError && err.status >= 400 && err.status < 500) {
    console.error('Electric sync stopped.', err);
    return;
  }

  if (err.name.includes('Parser') || err.name.includes('Schema')) {
    console.error('Electric sync stopped.', err);
    return;
  }

  console.warn('Electric sync retrying.', err);
  return {};
}
