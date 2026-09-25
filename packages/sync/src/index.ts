import type { Row } from '@electric-sql/client';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PersistedCollectionPersistence } from '@tanstack/browser-db-sqlite-persistence';
import type { ElectricCollectionConfig } from '@tanstack/electric-db-collection';
import type { z } from 'zod';

import { FetchError, snakeCamelMapper } from '@electric-sql/client';
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence';
import { BasicIndex, createCollection } from '@tanstack/db';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';

import { Replica } from '@canary/db/replica';

export type Event = Replica.Event;
export type Message = Replica.Message;
export type Part = Replica.Part;
export type Run = Replica.Run;
export type Thread = Replica.Thread;

export type Tx = { txid: number };
type Base = { base: string };
type Scope = Base & { ownerId: string };
type Schema = z.ZodType<Row<unknown>>;
type Descriptor<S extends Schema> = {
  readonly cacheVersion: number;
  readonly name: string;
  readonly schema: S;
};
type Output<S> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S> extends Row<unknown>
    ? StandardSchemaV1.InferOutput<S>
    : Record<string, unknown>
  : Record<string, unknown>;
type Handlers<S extends Schema> = Pick<
  ElectricCollectionConfig<Output<S>, S>,
  'onInsert' | 'onUpdate'
>;

const lists = new Map<string, ReturnType<typeof makeThreads>>();
const texts = new Map<string, ReturnType<typeof makeMessages>>();
const rns = new Map<string, ReturnType<typeof makeRuns>>();
const evs = new Map<string, ReturnType<typeof makeEvents>>();
const pts = new Map<string, ReturnType<typeof makeParts>>();
const ns = 'canary-sync';
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
    create: (input: { id: string; title: string }) => Promise<Tx>;
    settle: (input: { id: string; settled: boolean }) => Promise<Tx>;
    snooze: (input: { id: string; until: Date | null }) => Promise<Tx>;
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
    create: (input: { id: string; title: string }) => Promise<Tx>;
    settle: (input: { id: string; settled: boolean }) => Promise<Tx>;
    snooze: (input: { id: string; until: Date | null }) => Promise<Tx>;
  },
) {
  const col = make(Replica.Thread, opts, {
    onInsert: async ({ transaction }) => {
      const rows = transaction.mutations
        .map((item) => item.modified)
        .filter((item) => item.ownerId === opts.ownerId);

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
    // The list only ever edits how a thread is filed. Settling is one call
    // that also clears a snooze, so a change to both goes out as a settle.
    onUpdate: async ({ transaction }) => {
      const res = await Promise.all(
        transaction.mutations.flatMap((item) => {
          const id = item.original.id;

          if ('settledAt' in item.changes) {
            return [opts.settle({ id, settled: item.changes.settledAt != null })];
          }

          if ('snoozedUntil' in item.changes) {
            return [opts.snooze({ id, until: item.changes.snoozedUntil ?? null })];
          }

          return [];
        }),
      );

      if (!res.length) {
        return;
      }

      return {
        txid: res.map((item) => item.txid),
      };
    },
  });

  col.createIndex((row) => row.updatedAt, { indexType: BasicIndex });

  return col;
}

export function messages(opts: {
  base: string;
  ownerId: string;
  send: (input: { content: string; id: string; model?: string; threadId: string }) => Promise<Tx>;
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
  send: (input: { content: string; id: string; model?: string; threadId: string }) => Promise<Tx>;
}) {
  const col = make(Replica.Message, opts, {
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
            // The composer's pick rides on the message it was sent with.
            model: typeof item.metadata?.model === 'string' ? item.metadata.model : undefined,
          }),
        ),
      );

      return {
        txid: res.map((item) => item.txid),
      };
    },
  });

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
  const col = make(Replica.Run, opts);

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
  const col = make(Replica.Event, opts);

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
  const col = make(Replica.Part, opts);

  col.createIndex((row) => row.seq, { indexType: BasicIndex });
  col.createIndex((row) => row.threadId, { indexType: BasicIndex });
  col.createIndex((row) => row.runId, { indexType: BasicIndex });

  return col;
}

function make<const S extends Schema>(
  replica: Descriptor<S>,
  opts: Scope,
  handlers: Handlers<S> = {},
) {
  const cfg = electricCollectionOptions({
    id: `${ns}:${scope(opts)}:${replica.name}`,
    schema: replica.schema,
    getKey: (row) => String(row.id),
    shapeOptions: {
      url: url(opts.base, replica.name),
      columnMapper: snakeCamelMapper(),
      transformer: (row) => Object.assign(row, replica.schema.parse(row)),
      liveSse: true,
      onError: retry,
    },
    syncMode: 'eager',
    ...handlers,
  });
  const store = storage();

  if (!store) {
    return createCollection(cfg);
  }

  const saved = persistedCollectionOptions({
    ...cfg,
    persistence: store,
    schemaVersion: replica.cacheVersion,
  });

  return createCollection({
    ...saved,
    schema: replica.schema,
  });
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
