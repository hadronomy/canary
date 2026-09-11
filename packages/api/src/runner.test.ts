import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { event, message, part, run, thread } from '@canary/db/schema/app';

type Status = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running';
type Row = Record<string, unknown>;
type Client = {
  insert: (table: unknown) => Insert;
  select: (fields: Record<string, unknown>) => Select;
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
  events: [] as Row[],
  messages: [] as Row[],
  parts: [] as Row[],
  run: row('queued'),
};

let agent: (input: Input) => Promise<string> = async (input) => {
  await input.finish('ok', {});
  return ref.runId;
};

const db: Client = {
  insert(table: unknown) {
    return new Insert(table);
  },

  select(fields: Record<string, unknown>) {
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
  stream: (input: Input) => agent(input),
}));

mock.module('@canary/db', () => ({
  db,
}));

const runner = await import('./runner');

describe('agent runner failures', () => {
  beforeEach(() => {
    state.run = row('queued');
    state.messages = [
      {
        content: 'hello',
        ownerId: ref.ownerId,
        role: 'user',
        threadId: ref.threadId,
      },
    ];
    state.parts = [];
    state.events = [];
  });

  test('marks stream errors as failed runs with a visible error part', async () => {
    agent = async (input) => {
      await input.piece({ id: 'text', type: 'text-start' });
      await input.piece({ id: 'text', text: 'partial', type: 'text-delta' });
      throw new Error('Connection lost.');
    };

    runner.start(ref);
    await until(() => state.run.status === 'failed');

    expect(state.run.error).toBe('Connection lost.');
    expect(state.parts.find((item) => item.kind === 'text')?.status).toBe('failed');
    expect(state.parts.find((item) => item.kind === 'error')?.content).toBe('Connection lost.');
  });

  test('deduplicates repeated terminal stream errors', async () => {
    agent = async (input) => {
      await input.fail(new Error('Provider stopped.'));
      await input.fail(new Error('Provider stopped again.'));
      throw new Error('Provider stopped yet again.');
    };

    runner.start(ref);
    await until(() => state.run.status === 'failed');

    expect(state.run.error).toBe('Provider stopped.');
    expect(state.parts.filter((item) => item.kind === 'error')).toHaveLength(1);
  });

  test('keeps user cancellation distinct from failures', async () => {
    state.run = row('running');
    state.parts = [
      {
        content: '',
        kind: 'text',
        ownerId: ref.ownerId,
        runId: ref.runId,
        seq: 0,
        status: 'running',
        threadId: ref.threadId,
      },
    ];

    await runner.cancel(ref);

    expect(state.run.status).toBe('cancelled');
    expect(state.run.error).toBeNull();
    expect(state.parts[0]?.status).toBe('cancelled');
    expect(state.parts.some((item) => item.kind === 'error')).toBeFalse();
  });
});

class Select {
  private table: unknown;

  constructor(private fields: Record<string, unknown>) {}

  from(table: unknown) {
    this.table = table;
    return this;
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
    return Promise.resolve(this.rows());
  }

  onConflictDoUpdate(_opts?: unknown) {
    return Promise.resolve(this.rows());
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
    return Object.keys(fields).length === 1 ? [{ status: state.run.status }] : [state.run];
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
      } else {
        state.parts.push({ id: `part-${state.parts.length}`, messageId: null, ...item });
      }
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
