import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Effect } from 'effect';

import { event, message, part, run, thread } from '@canary/db/schema/app';

type Status = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running';
type Row = Record<string, unknown>;
type Client = {
  insert: (table: unknown) => Insert;
  select: (fields?: Record<string, unknown>) => Select;
  transaction: <T>(fn: (client: Client) => Promise<T> | T) => Promise<T>;
  update: (table: unknown) => Update;
};
type Input = {
  fail: (err: Error) => Promise<void> | void;
  finish: (text: string, data: Record<string, unknown>) => Promise<void> | void;
  piece: (part: Piece) => Promise<void> | void;
};
type Piece =
  | { id: string; type: 'text-start' }
  | { id: string; text: string; type: 'text-delta' }
  | { id: string; type: 'text-end' };

const ref = {
  ownerId: 'user-1',
  runId: 'run-1',
  threadId: 'thread-1',
};

const state = {
  agent: async (input: Input) => {
    state.calls += 1;
    await input.finish('ok', {});
    return ref.runId;
  },
  calls: 0,
  events: [] as Row[],
  messages: [] as Row[],
  parts: [] as Row[],
  run: row('queued'),
  thread: {
    archivedAt: null as Date | null,
    id: ref.threadId,
    ownerId: ref.ownerId,
    title: 'Test thread',
  },
};

const db: Client = {
  insert(table: unknown) {
    return new Insert(table);
  },

  select(fields: Record<string, unknown> = {}) {
    return new Select(fields);
  },

  transaction<T>(fn: (client: typeof db) => Promise<T> | T) {
    return Promise.resolve(fn(db));
  },

  update(table: unknown) {
    return new Update(table);
  },
};

mock.module('@canary/agents', () => ({
  stream: (input: Input) => state.agent(input),
}));

mock.module('@canary/db', () => ({
  db,
  txid: () => Promise.resolve(1),
}));

mock.module('@canary/env/server', () => ({
  env: { AGENT_MODEL: 'test-model' },
}));

const runner = await import('./runner');
const runs = await Effect.runPromise(runner.Run.Service.pipe(Effect.provide(runner.Run.layer)));

describe('Run', () => {
  beforeEach(() => {
    state.run = row('queued');
    state.thread = {
      archivedAt: null,
      id: ref.threadId,
      ownerId: ref.ownerId,
      title: 'Test thread',
    };
    state.messages = [
      {
        id: 'message-history',
        content: 'hello',
        ownerId: ref.ownerId,
        role: 'user',
        threadId: ref.threadId,
      },
    ];
    state.parts = [];
    state.events = [];
    state.calls = 0;
    state.agent = async (input) => {
      state.calls += 1;
      await input.finish('ok', {});
      return ref.runId;
    };
  });

  test('starts a run after send returns the queued record', async () => {
    const res = await Effect.runPromise(
      runs.send({
        content: 'hello',
        id: 'message-1',
        owner: ref.ownerId,
        threadId: ref.threadId,
      }),
    );
    await until(() => state.calls === 1);

    expect(res.message).toMatchObject({
      content: 'hello',
      id: 'message-1',
      ownerId: ref.ownerId,
      threadId: ref.threadId,
    });
    expect(res.run).toMatchObject({
      id: ref.runId,
      ownerId: ref.ownerId,
      status: 'queued',
      threadId: ref.threadId,
    });
    expect(res.txid).toBe(1);
  });

  test('cancels a run once', async () => {
    state.run = row('running');
    const first = await Effect.runPromise(runs.cancel({ id: ref.runId, owner: ref.ownerId }));
    const second = await Effect.runPromise(runs.cancel({ id: ref.runId, owner: ref.ownerId }));

    expect(first.run).toMatchObject({
      error: null,
      id: ref.runId,
      status: 'cancelled',
    });
    expect(first.txid).toBe(1);
    expect(second.run).toBeNull();
  });

  test('uses the same cancel path when it archives a thread', async () => {
    state.run = row('running');

    const res = await Effect.runPromise(runs.archive({ id: ref.threadId, owner: ref.ownerId }));
    const stopped = await Effect.runPromise(runs.cancel({ id: ref.runId, owner: ref.ownerId }));

    expect(res.thread).toMatchObject({
      id: ref.threadId,
      ownerId: ref.ownerId,
    });
    expect(res.thread?.archivedAt).toBeInstanceOf(Date);
    expect(stopped.run).toBeNull();
  });
});

class Select {
  private table: unknown;

  constructor(private fields: Record<string, unknown>) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  groupBy(_field: unknown) {
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

  limit(_count: number) {
    return Promise.resolve(select(this.table, this.fields));
  }

  orderBy(_field: unknown) {
    return this;
  }

  where(_cond: unknown) {
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

  where(_cond: unknown) {
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

  onConflictDoNothing(_opts?: unknown) {
    this.rows();
    return this;
  }

  onConflictDoUpdate(_opts?: unknown) {
    this.rows();
    return this;
  }

  returning() {
    return Promise.resolve(this.rows());
  }

  values(data: Row | Row[]) {
    this.data = data;
    this.rows();
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
      return [];
    }

    return Object.keys(fields).length === 1 ? [{ status: state.run.status }] : [state.run];
  }

  if (table === thread) {
    return [state.thread];
  }

  if (table === message) {
    return state.messages;
  }

  return [];
}

function update(table: unknown, data: Row) {
  if (table === run) {
    return updateRun(data);
  }

  if (table === part) {
    state.parts = state.parts.map((item) => {
      if (item.status !== 'pending' && item.status !== 'running') {
        return item;
      }

      return { ...item, ...data };
    });
  }

  if (table === thread) {
    if (data.archivedAt && !state.thread.archivedAt) {
      state.thread = { ...state.thread, ...data };
      return [state.thread];
    }

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
    (data.status === 'failed' || data.status === 'cancelled') &&
    (state.run.status === 'queued' || state.run.status === 'running')
  ) {
    state.run = { ...state.run, ...data };
    return [state.run];
  }

  if (data.updatedAt && state.run.status === 'running') {
    state.run = { ...state.run, ...data };
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
      if (state.events.some((hit) => hit.runId === item.runId && hit.seq === item.seq)) {
        return;
      }

      state.events.push(item);
    });
  }

  if (table === message) {
    state.messages.push(...rows);
  }

  if (table === run) {
    const item = rows[0];

    if (!item) {
      return [];
    }

    state.run = { ...row('queued'), ...item, id: ref.runId };
    return [state.run];
  }

  if (table === thread) {
    return rows;
  }

  return rows;
}

function row(status: Status) {
  return {
    completedAt: null,
    error: null as string | null,
    id: ref.runId,
    model: 'test-model',
    ownerId: ref.ownerId,
    status,
    threadId: ref.threadId,
    updatedAt: new Date(),
  };
}

async function until(fn: () => boolean) {
  for (const _ of Array.from({ length: 50 })) {
    if (fn()) {
      return;
    }

    await Bun.sleep(5);
  }

  throw new Error('Timed out waiting for condition.');
}
