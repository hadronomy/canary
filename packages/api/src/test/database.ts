import { Deferred, Effect } from 'effect';

import { event, message, part, run, thread } from '@canary/db/schema/app';

type Status = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running';
type Row = Record<string, unknown>;
type Client = {
  $client: { end: () => Promise<void> };
  execute: () => Promise<{ rows: { txid: string }[] }>;
  insert: (table: unknown) => Insert;
  select: (fields?: Record<string, unknown>) => Select;
  transaction: <T>(fn: (client: Client) => Promise<T> | T) => Promise<T>;
  update: (table: unknown) => Update;
};

export const ids = {
  message: '00000000-0000-4000-8000-000000000003',
  owner: 'user-1',
  run: '00000000-0000-4000-8000-000000000001',
  thread: '00000000-0000-4000-8000-000000000002',
};

export const state = {
  closed: 0,
  events: [] as Row[],
  lookup: undefined as string | undefined,
  messages: [] as Row[],
  parts: [] as Row[],
  queued: [] as Row[],
  run: row('completed'),
  scans: 0,
  stale: [] as Row[],
  thread: {
    createdAt: new Date(),
    id: ids.thread,
    ownerId: ids.owner,
    settledAt: null as Date | null,
    snoozedUntil: null as Date | null,
    model: null as string | null,
    title: 'Test thread',
    updatedAt: new Date(),
  },
  // Stands in for a thread the caller cannot see: someone else's, or gone.
  missing: false,
  failed: Deferred.makeUnsafe<void>(),
};

export function reset(status: Status = 'queued') {
  state.closed = 0;
  state.events = [];
  state.lookup = undefined;
  state.messages = [
    {
      id: '00000000-0000-4000-8000-000000000004',
      content: 'history',
      ownerId: ids.owner,
      role: 'user',
      threadId: ids.thread,
    },
  ];
  state.parts = [];
  state.queued = [];
  state.run = row(status);
  state.scans = 0;
  state.stale = [];
  state.thread = {
    createdAt: new Date(),
    id: ids.thread,
    ownerId: ids.owner,
    settledAt: null,
    snoozedUntil: null,
    model: null,
    title: 'Test thread',
    updatedAt: new Date(),
  };
  state.missing = false;
  state.failed = Deferred.makeUnsafe();
}

export const db: Client = {
  $client: {
    end() {
      state.closed += 1;
      return Promise.resolve();
    },
  },
  execute() {
    return Promise.resolve({ rows: [{ txid: '1' }] });
  },
  insert(table: unknown) {
    return new Insert(table);
  },
  select(fields: Record<string, unknown> = {}) {
    return new Select(fields);
  },
  transaction<T>(fn: (client: Client) => Promise<T> | T) {
    return Promise.resolve(fn(db));
  },
  update(table: unknown) {
    return new Update(table);
  },
};

class Select {
  private table: unknown;

  constructor(private fields: Record<string, unknown>) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  groupBy() {
    const ids = [...new Set(state.events.map((item) => item.runId))];
    return Promise.resolve(
      ids.map((id) => ({
        runId: id,
        seq: Math.max(
          ...state.events.filter((item) => item.runId === id).map((item) => Number(item.seq)),
        ),
      })),
    );
  }

  limit() {
    return Promise.resolve(select(this.table, this.fields));
  }

  orderBy() {
    return this;
  }

  where() {
    return this;
  }
}

class Update {
  private data: Row = {};
  private done: Row[] | undefined;

  constructor(private table: unknown) {}

  returning() {
    return Promise.resolve(this.rows());
  }

  set(data: Row) {
    this.data = data;
    return this;
  }

  where() {
    this.rows();
    return this;
  }

  private rows() {
    this.done ??= update(this.table, this.data);
    return this.done;
  }
}

class Insert {
  private data: Row | Row[] = {};
  private done: Row[] | undefined;

  constructor(private table: unknown) {}

  onConflictDoNothing() {
    this.rows();
    return this;
  }

  onConflictDoUpdate() {
    this.rows();
    return this;
  }

  returning() {
    return Promise.resolve(this.rows());
  }

  values(data: Row | Row[]) {
    this.data = data;
    return this;
  }

  private rows() {
    this.done ??= insert(this.table, this.data);
    return this.done;
  }
}

function select(table: unknown, fields: Record<string, unknown>) {
  if (table === run) {
    if (Object.hasOwn(fields, 'runId')) {
      const rows = state.scans % 2 === 0 ? state.queued : state.stale;
      state.scans += 1;
      return rows;
    }
    return [state.run];
  }

  if (table === thread) {
    if (Object.hasOwn(fields, 'id') && state.missing) return [];
    return [state.thread];
  }

  if (table === message) {
    if (Object.hasOwn(fields, 'role')) return state.messages;
    return state.messages.filter((row) => row.id === state.lookup);
  }

  return [];
}

function update(table: unknown, data: Row) {
  if (table === run) return updateRun(data);

  if (table === part) {
    state.parts = state.parts.map((item) => {
      if (data.messageId || item.status === 'pending' || item.status === 'running') {
        return { ...item, ...data };
      }
      return item;
    });
  }

  if (table === thread) {
    state.thread = { ...state.thread, ...data };
    return [state.thread];
  }

  return [];
}

function updateRun(data: Row) {
  if (data.status === 'running' && state.run.status === 'queued') {
    state.run = { ...state.run, ...data };
    return [state.run];
  }

  if (
    (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') &&
    (state.run.status === 'queued' || state.run.status === 'running')
  ) {
    state.run = { ...state.run, ...data };
    if (data.status === 'failed') Deferred.doneUnsafe(state.failed, Effect.void);
    return [state.run];
  }

  if (data.updatedAt && state.run.status === 'running') {
    state.run = { ...state.run, ...data };
    return [state.run];
  }

  return [];
}

function insert(table: unknown, data: Row | Row[]) {
  const rows = Array.isArray(data) ? data : [data];

  if (table === part) {
    rows.forEach((item) => {
      const index = state.parts.findIndex(
        (hit) => hit.runId === item.runId && hit.seq === item.seq,
      );
      if (index >= 0) {
        state.parts[index] = { ...state.parts[index], ...item };
        return;
      }
      state.parts.push({ id: `part-${state.parts.length}`, messageId: null, ...item });
    });
  }

  if (table === event) {
    rows.forEach((item) => {
      if (state.events.some((hit) => hit.runId === item.runId && hit.seq === item.seq)) return;
      state.events.push(item);
    });
  }

  if (table === message) {
    const item = rows[0];
    if (!item) return [];

    state.lookup = String(item.id ?? `message-${state.messages.length}`);
    if (state.messages.some((row) => row.id === state.lookup)) return [];

    const row = {
      id: state.lookup,
      runId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...item,
    };
    state.messages.push(row);
    return [row];
  }

  if (table === run) {
    const item = rows[0];
    if (!item) return [];
    if (state.run.inputMessageId === item.inputMessageId) return [];

    state.run = { ...row('queued'), ...item, id: ids.run };
    return [state.run];
  }

  return rows;
}

function row(status: Status) {
  return {
    completedAt: null,
    createdAt: new Date(),
    error: null as string | null,
    id: ids.run,
    inputMessageId: null as string | null,
    model: 'test-model',
    ownerId: ids.owner,
    startedAt: null,
    status,
    threadId: ids.thread,
    updatedAt: new Date(),
  };
}
