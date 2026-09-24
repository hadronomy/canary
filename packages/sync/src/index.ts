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
import { ZodError } from 'zod';

import { Replica } from '@canary/db/replica';

export type Event = Replica.Event;
export type Message = Replica.Message;
export type Part = Replica.Part;
export type Run = Replica.Run;
export type Thread = Replica.Thread;

export type Tx = { txid: number };
export type Fault = {
  readonly state: 'retrying' | 'stopped';
  readonly shape: string;
  readonly reason: string;
};
type Base = { base: string };
type Scope = Base & { ownerId: string };
type Schema = z.ZodObject;
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
const faults = new Map<string, Fault>();
const listeners = new Set<() => void>();
const ns = 'canary-sync';
let disk: PersistedCollectionPersistence | null | undefined;
let boot: Promise<void> | undefined;
let epoch = 0;

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

export function health(opts: Scope): Fault | undefined {
  const prefix = `${scope(opts)}:`;
  const issues = [...faults].filter(([key]) => key.startsWith(prefix)).map(([, fault]) => fault);

  return issues.find((item) => item.state === 'stopped') ?? issues[0];
}

export function watch(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clear() {
  epoch++;
  [...lists.values(), ...texts.values(), ...rns.values(), ...evs.values(), ...pts.values()].forEach(
    (col) => void col.cleanup(),
  );
  lists.clear();
  texts.clear();
  rns.clear();
  evs.clear();
  pts.clear();
  faults.clear();
  listeners.forEach((listener) => listener());
}

export function threads(
  opts: Scope & {
    archive: (input: { id: string }) => Promise<Tx>;
    create: (input: { id: string; title: string }) => Promise<Tx>;
    rename: (input: { id: string; title: string }) => Promise<Tx>;
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
    rename: (input: { id: string; title: string }) => Promise<Tx>;
  },
) {
  const col = make(Replica.Thread, opts, {
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
      const writes = transaction.mutations.flatMap((item) => {
        if (item.changes.archivedAt != null) {
          return [opts.archive({ id: item.original.id })];
        }
        if (typeof item.changes.title === 'string') {
          return [opts.rename({ id: item.original.id, title: item.changes.title })];
        }
        return [];
      });

      if (!writes.length) {
        return;
      }

      const res = await Promise.all(writes);

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
  const key = `${scope(opts)}:${replica.name}`;
  const current = epoch;
  const cfg = electricCollectionOptions({
    id: `${ns}:${key}`,
    schema: replica.schema,
    getKey: (row) => String(row.id),
    shapeOptions: {
      url: url(opts.base, replica.name),
      columnMapper: snakeCamelMapper(),
      transformer: (row) => Object.assign(row, replica.schema.partial().parse(row)),
      liveSse: true,
      fetchClient: Object.assign(
        async (...args: Parameters<typeof fetch>) => {
          try {
            const res = await fetch(...args);
            if (current !== epoch) {
              return res;
            }
            if (res.ok || res.status === 304) {
              recover(key);
            } else if (res.status === 429 || res.status >= 500) {
              const reason = `HTTP ${res.status}`;
              if (report(key, { state: 'retrying', shape: replica.name, reason })) {
                console.warn(`Electric shape ${replica.name} retrying: ${reason}`);
              }
            }
            return res;
          } catch (err) {
            if (current === epoch && !args[1]?.signal?.aborted) {
              const reason = cause(err);
              if (report(key, { state: 'retrying', shape: replica.name, reason })) {
                console.warn(`Electric shape ${replica.name} retrying: ${reason}`, err);
              }
            }
            throw err;
          }
        },
        { preconnect: fetch.preconnect },
      ),
      onError: (err) => (current === epoch ? retry(key, replica.name, err) : undefined),
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

function report(key: string, fault: Fault) {
  const prev = faults.get(key);
  if (prev?.state === fault.state && prev.reason === fault.reason) {
    return false;
  }
  faults.set(key, fault);
  listeners.forEach((listener) => listener());
  return true;
}

function recover(key: string) {
  if (faults.get(key)?.state !== 'retrying') {
    return;
  }
  faults.delete(key);
  listeners.forEach((listener) => listener());
}

function cause(err: unknown) {
  if (err instanceof FetchError) {
    return `HTTP ${err.status}`;
  }
  if (err instanceof ZodError) {
    return 'Row schema mismatch';
  }
  if (err instanceof Error && missing(err)) {
    return 'Electric response is missing required headers';
  }
  return err instanceof Error ? err.message : String(err);
}

function missing(err: Error) {
  return err.message.includes("didn't include the following required headers");
}

function retry(key: string, shape: string, err: Error) {
  const stopped =
    (err instanceof FetchError && err.status >= 400 && err.status < 500) ||
    err instanceof ZodError ||
    err.name.includes('Parser') ||
    err.name.includes('Schema') ||
    missing(err);
  const fault: Fault = {
    state: stopped ? 'stopped' : 'retrying',
    shape,
    reason: cause(err),
  };

  report(key, fault);
  if (stopped) {
    console.error(`Electric shape ${shape} stopped: ${fault.reason}`, err);
    return;
  }

  console.warn(`Electric shape ${shape} retrying: ${fault.reason}`, err);
  return {};
}
