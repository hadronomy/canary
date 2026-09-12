export * as Run from '~/runner';

import { and, asc, desc, eq, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import { Cause, Context, Effect, Layer } from 'effect';

import { stream, type Chat, type Piece } from '@canary/agents';
import { db, txid } from '@canary/db';
import { event, message, part, run, thread } from '@canary/db/schema/app';
import { env } from '@canary/env/server';
import { own } from '~/scope';

type Ref = {
  ownerId: string;
  runId: string;
  threadId: string;
};

type Send = {
  content: string;
  id?: string;
  owner: string;
  threadId: string;
};

type Key = {
  id: string;
  owner: string;
};

type Sent = {
  message: typeof message.$inferSelect;
  run: typeof run.$inferSelect;
  txid: number;
};

type Cancelled = {
  run: typeof run.$inferSelect | null;
  txid: number;
};

type Archived = {
  thread: typeof thread.$inferSelect | null;
  txid: number;
};

type Row = typeof run.$inferSelect;
type Client = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Log = {
  data?: Record<string, unknown>;
  ownerId: string;
  runId: string;
  threadId: string;
  type: string;
};

export interface Interface {
  readonly send: (input: Send) => Effect.Effect<Sent>;
  readonly cancel: (input: Key) => Effect.Effect<Cancelled>;
  readonly archive: (input: Key) => Effect.Effect<Archived>;
}

export class Service extends Context.Service<Service, Interface>()('@canary/api/Run') {}

type Draft = {
  content: string;
  data: Record<string, unknown> | null;
  kind: 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'artifact' | 'error' | 'status';
  seq: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  toolName: string | null;
};

const ttl = 10 * 60 * 1000;
const gap = 30 * 1000;
const gate = { boot: false, last: 0 };

const start = Effect.fn('Run.start')(function* (ref: Ref) {
  yield* Effect.promise(() => runOne(ref)).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }

      return Effect.promise(() => failRun(ref, Cause.squash(cause))).pipe(
        Effect.catchCause((next) =>
          Effect.logError('Agent run failure could not be persisted.', next),
        ),
      );
    }),
  );
});

const recover = Effect.fn('Run.recover')(function* () {
  if (gate.boot || Date.now() - gate.last < gap) {
    return;
  }

  gate.boot = true;
  gate.last = Date.now();
  yield* Effect.gen(function* () {
    const state = yield* Effect.promise(() => recoverRuns());
    yield* Effect.forEach(state.queued, (row) => start(row).pipe(Effect.forkDetach), {
      discard: true,
    });
    yield* Effect.promise(() =>
      Promise.all(
        state.stale.map((row) => failRun(row, new Error('Agent runner recovered stale run.'))),
      ),
    );
  }).pipe(
    Effect.catchCause((cause) => Effect.logError('Agent run recovery failed.', cause)),
    Effect.ensuring(
      Effect.sync(() => {
        gate.boot = false;
      }),
    ),
  );
});

const send = Effect.fn('Run.send')(function* (input: Send) {
  const res = yield* Effect.promise(() => sending(input));
  yield* start({
    ownerId: input.owner,
    runId: res.run.id,
    threadId: input.threadId,
  }).pipe(Effect.forkDetach);
  return res;
});

const cancel = Effect.fn('Run.cancel')((input: Key) => Effect.promise(() => cancelling(input)));

const archive = Effect.fn('Run.archive')((input: Key) => Effect.promise(() => archiving(input)));

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* recover().pipe(Effect.forkDetach);
    return Service.of({ send, cancel, archive });
  }),
);

async function sending(input: Send): Promise<Sent> {
  return await db.transaction(async (client) => {
    const rows = await client
      .select({ id: thread.id })
      .from(thread)
      .where(own(thread, input.owner, eq(thread.id, input.threadId), isNull(thread.archivedAt)))
      .limit(1);

    if (!rows[0]) {
      throw new Error('Thread not found.');
    }

    const sent = await client
      .insert(message)
      .values({
        id: input.id,
        threadId: input.threadId,
        ownerId: input.owner,
        role: 'user',
        content: input.content,
      })
      .onConflictDoNothing({
        target: message.id,
      })
      .returning();
    const found = input.id
      ? await client
          .select()
          .from(message)
          .where(
            own(
              message,
              input.owner,
              eq(message.id, input.id),
              eq(message.threadId, input.threadId),
            ),
          )
          .limit(1)
      : [];
    const row = sent[0] ?? found[0];

    if (!row) {
      throw new Error('Message insert failed.');
    }

    const queued = await client
      .insert(run)
      .values({
        threadId: input.threadId,
        ownerId: input.owner,
        inputMessageId: row.id,
        status: 'queued',
        model: env.AGENT_MODEL,
      })
      .onConflictDoNothing({
        target: run.inputMessageId,
      })
      .returning();
    const active = await client
      .select()
      .from(run)
      .where(own(run, input.owner, eq(run.inputMessageId, row.id)))
      .limit(1);
    const item = queued[0] ?? active[0];

    if (!item) {
      throw new Error('Run insert failed.');
    }

    await client
      .insert(event)
      .values({
        runId: item.id,
        threadId: item.threadId,
        ownerId: input.owner,
        seq: 0,
        type: 'run.queued',
        data: { model: env.AGENT_MODEL },
      })
      .onConflictDoNothing({
        target: [event.runId, event.seq],
      });

    await client
      .update(thread)
      .set({ updatedAt: new Date() })
      .where(own(thread, input.owner, eq(thread.id, input.threadId)));

    return {
      message: row,
      run: item,
      txid: await txid(client),
    };
  });
}

async function cancelling(input: Key): Promise<Cancelled> {
  return await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(
        own(run, input.owner, eq(run.id, input.id), inArray(run.status, ['queued', 'running'])),
      )
      .returning();

    await cancelled(client, rows);

    return {
      run: rows[0] ?? null,
      txid: await txid(client),
    };
  });
}

async function archiving(input: Key): Promise<Archived> {
  return await db.transaction(async (client) => {
    const rows = await client
      .update(thread)
      .set({ archivedAt: new Date() })
      .where(own(thread, input.owner, eq(thread.id, input.id), isNull(thread.archivedAt)))
      .returning();

    const active = await client
      .update(run)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(
        own(
          run,
          input.owner,
          eq(run.threadId, input.id),
          inArray(run.status, ['queued', 'running']),
        ),
      )
      .returning();

    await cancelled(client, active);

    return {
      thread: rows[0] ?? null,
      txid: await txid(client),
    };
  });
}

async function cancelled(client: Client, rows: readonly Row[]) {
  const first = rows.at(0);

  if (!first) {
    return;
  }

  const ids = rows.map((row) => row.id);
  await client
    .update(part)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(
      own(
        part,
        first.ownerId,
        inArray(part.runId, ids),
        inArray(part.status, ['pending', 'running']),
      ),
    );

  await record(
    client,
    rows.map((row) => ({
      runId: row.id,
      threadId: row.threadId,
      ownerId: row.ownerId,
      type: 'run.cancelled',
    })),
  );
}

async function record(client: Client, rows: readonly Log[]) {
  const first = rows.at(0);

  if (!first) {
    return;
  }

  const seqs = await client
    .select({
      runId: event.runId,
      seq: max(event.seq),
    })
    .from(event)
    .where(
      own(
        event,
        first.ownerId,
        inArray(
          event.runId,
          rows.map((row) => row.runId),
        ),
      ),
    )
    .groupBy(event.runId);
  const next = new Map(seqs.map((row) => [row.runId, row.seq ?? -1]));

  await client
    .insert(event)
    .values(
      rows.map((row) => ({
        ...row,
        seq: (next.get(row.runId) ?? -1) + 1,
      })),
    )
    .onConflictDoNothing({
      target: [event.runId, event.seq],
    });
}

async function runOne(ref: Ref) {
  const row = await claim(ref);

  if (!row) {
    return;
  }

  const sink = writer(ref);

  try {
    const rows = await db
      .select({
        role: message.role,
        content: message.content,
      })
      .from(message)
      .where(own(message, ref.ownerId, eq(message.threadId, ref.threadId)))
      .orderBy(desc(message.createdAt))
      .limit(24);

    await stream({
      ...ref,
      messages: rows.reverse() as Chat[],
      piece: sink.piece,
      finish: sink.finish,
      fail: sink.fail,
    });
  } catch (err) {
    await sink.fail(err);
  }
}

async function claim(ref: Ref) {
  return await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(own(run, ref.ownerId, eq(run.id, ref.runId), eq(run.status, 'queued')))
      .returning();

    const row = rows[0];

    if (!row) {
      return null;
    }

    await client
      .insert(event)
      .values({
        runId: row.id,
        threadId: row.threadId,
        ownerId: row.ownerId,
        seq: 1,
        type: 'run.started',
        data: { model: row.model },
      })
      .onConflictDoNothing({
        target: [event.runId, event.seq],
      });

    return row;
  });
}

function writer(ref: Ref) {
  const slots = new Map<string, Draft>();
  const dirty = new Map<number, Draft>();
  const texts = new Map<string, string>();
  let seq = 0;
  let log = 2;
  let seg = 0;
  let tick: ReturnType<typeof setTimeout> | undefined;
  let failed: Promise<void> | undefined;

  function slot(key: string, init: Omit<Draft, 'seq'>) {
    const hit = slots.get(key);

    if (hit) {
      return hit;
    }

    const row = { ...init, seq };
    seq += 1;
    slots.set(key, row);

    return row;
  }

  function text(id: string, fresh = false) {
    const hit = texts.get(id);

    if (hit && !fresh) {
      return hit;
    }

    if (hit) {
      close(hit);
    }

    const key = `text:${id}:${seg}`;
    seg += 1;
    texts.set(id, key);

    return key;
  }

  function close(key: string) {
    const row = slots.get(key);

    if (!row || row.kind !== 'text' || row.status !== 'running') {
      return;
    }

    row.status = 'completed';
    push(row);
  }

  function edge() {
    texts.forEach((key) => {
      close(key);
    });
    texts.clear();
  }

  function push(row: Draft) {
    dirty.set(row.seq, row);

    if (tick) {
      return;
    }

    tick = setTimeout(() => {
      flush().catch((err: unknown) => {
        console.error('Agent part flush failed.', err);
      });
    }, 60);
  }

  async function flush() {
    if (tick) {
      clearTimeout(tick);
      tick = undefined;
    }

    const rows = [...dirty.values()].map((row) => ({ ...row }));
    dirty.clear();

    if (!rows.length) {
      return;
    }

    await db
      .transaction(async (client) => {
        const active = await client
          .update(run)
          .set({ updatedAt: new Date() })
          .where(own(run, ref.ownerId, eq(run.id, ref.runId), eq(run.status, 'running')))
          .returning();

        if (!active[0]) {
          return;
        }

        await client
          .insert(part)
          .values(
            rows.map((row) => ({
              runId: ref.runId,
              threadId: ref.threadId,
              ownerId: ref.ownerId,
              seq: row.seq,
              kind: row.kind,
              status: row.status,
              toolName: row.toolName,
              content: row.content,
              data: row.data,
            })),
          )
          .onConflictDoUpdate({
            target: [part.runId, part.seq],
            set: {
              kind: sql`excluded.kind`,
              status: sql`excluded.status`,
              toolName: sql`excluded.tool_name`,
              content: sql`excluded.content`,
              data: sql`excluded.data`,
              updatedAt: new Date(),
            },
          });

        await client.insert(event).values(
          rows.map((row) => {
            const item = {
              runId: ref.runId,
              threadId: ref.threadId,
              ownerId: ref.ownerId,
              seq: log,
              type: 'message.part',
              data: {
                partSeq: row.seq,
                kind: row.kind,
                status: row.status,
              },
            };
            log += 1;
            return item;
          }),
        );
      })
      .catch((err: unknown) => {
        rows.forEach((row) => {
          if (!dirty.has(row.seq)) {
            dirty.set(row.seq, row);
          }
        });
        throw err;
      });
  }

  async function piece(input: Piece) {
    if (failed) {
      return;
    }

    if (input.type === 'text-start') {
      push(
        slot(text(input.id, true), {
          kind: 'text',
          status: 'running',
          content: '',
          data: null,
          toolName: null,
        }),
      );
      return;
    }

    if (input.type === 'text-delta') {
      const row = slot(text(input.id), {
        kind: 'text',
        status: 'running',
        content: '',
        data: null,
        toolName: null,
      });
      row.content += input.text;
      push(row);
      return;
    }

    if (input.type === 'text-end') {
      const key = texts.get(input.id);

      if (!key) {
        return;
      }

      const row = slot(key, {
        kind: 'text',
        status: 'running',
        content: '',
        data: null,
        toolName: null,
      });
      row.status = 'completed';
      texts.delete(input.id);
      push(row);
      return;
    }

    if (input.type === 'reasoning-start') {
      edge();
      push(
        slot(`reasoning:${input.id}`, {
          kind: 'reasoning',
          status: 'running',
          content: '',
          data: null,
          toolName: null,
        }),
      );
      return;
    }

    if (input.type === 'reasoning-delta') {
      edge();
      const row = slot(`reasoning:${input.id}`, {
        kind: 'reasoning',
        status: 'running',
        content: '',
        data: null,
        toolName: null,
      });
      row.content += input.text;
      push(row);
      return;
    }

    if (input.type === 'reasoning-end') {
      edge();
      const row = slot(`reasoning:${input.id}`, {
        kind: 'reasoning',
        status: 'running',
        content: '',
        data: null,
        toolName: null,
      });
      row.status = 'completed';
      push(row);
      return;
    }

    if (input.type === 'tool-call') {
      edge();
      push(
        slot(`tool:${input.id}`, {
          kind: 'tool-call',
          status: 'running',
          content: '',
          data: input.data,
          toolName: input.name,
        }),
      );
      return;
    }

    if (input.type === 'tool-delta') {
      edge();
      const row = slot(`tool:${input.id}`, {
        kind: 'tool-call',
        status: 'running',
        content: '',
        data: null,
        toolName: input.name,
      });
      row.content += input.text;
      push(row);
      return;
    }

    if (input.type === 'tool-result') {
      edge();
      const row = slot(`tool:${input.id}`, {
        kind: 'tool-call',
        status: 'running',
        content: '',
        data: null,
        toolName: input.name,
      });
      row.kind = 'tool-result';
      row.status = 'completed';
      row.data = input.data;
      row.toolName = input.name;
      push(row);
      return;
    }
  }

  async function finish(text: string, data: Record<string, unknown>) {
    if (failed) {
      return;
    }

    edge();
    await flush();
    const body =
      text ||
      [...slots.values()]
        .filter((row) => row.kind === 'text')
        .toSorted((a, b) => a.seq - b.seq)
        .map((row) => row.content)
        .join('');

    await db.transaction(async (client) => {
      const rows = await client
        .update(run)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(
          own(run, ref.ownerId, eq(run.id, ref.runId), inArray(run.status, ['queued', 'running'])),
        )
        .returning();

      const row = rows[0];

      if (!row) {
        return;
      }

      const sent = await client
        .insert(message)
        .values({
          threadId: ref.threadId,
          ownerId: ref.ownerId,
          runId: ref.runId,
          role: 'assistant',
          content: body,
          metadata: data,
        })
        .returning();

      const msg = sent[0];

      if (msg) {
        await client
          .update(part)
          .set({
            messageId: msg.id,
            updatedAt: new Date(),
          })
          .where(eq(part.runId, ref.runId));
      }

      await client
        .update(thread)
        .set({ updatedAt: new Date() })
        .where(own(thread, ref.ownerId, eq(thread.id, ref.threadId)));

      await client
        .insert(event)
        .values({
          runId: ref.runId,
          threadId: ref.threadId,
          ownerId: ref.ownerId,
          seq: log,
          type: 'run.completed',
          data,
        })
        .onConflictDoNothing({
          target: [event.runId, event.seq],
        });
    });
  }

  async function fail(cause: unknown) {
    failed ??= failOnce(cause);
    await failed;
  }

  async function failOnce(cause: unknown) {
    const err = reason(cause);
    texts.clear();
    slots.forEach((row) => {
      if (row.status !== 'pending' && row.status !== 'running') {
        return;
      }

      row.status = 'failed';
      push(row);
    });

    const row = slot('error:terminal', {
      kind: 'error',
      status: 'failed',
      content: err,
      data: null,
      toolName: null,
    });
    row.content = err;
    row.status = 'failed';
    push(row);

    await flush();
    await failRun(ref, err);
  }

  return { piece, flush, finish, fail };
}

async function failRun(ref: Ref, cause: unknown) {
  const err = reason(cause);

  await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'failed',
        error: err,
        completedAt: new Date(),
      })
      .where(
        own(run, ref.ownerId, eq(run.id, ref.runId), inArray(run.status, ['queued', 'running'])),
      )
      .returning();

    const row = rows[0];

    if (!row) {
      return;
    }

    await client
      .update(part)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(
        own(
          part,
          ref.ownerId,
          eq(part.runId, ref.runId),
          inArray(part.status, ['pending', 'running']),
        ),
      );

    await record(client, [
      {
        runId: ref.runId,
        threadId: ref.threadId,
        ownerId: ref.ownerId,
        type: 'run.failed',
        data: { error: err },
      },
    ]);
  });
}

async function recoverRuns() {
  const before = new Date(Date.now() - ttl);
  const queued = await db
    .select({
      runId: run.id,
      threadId: run.threadId,
      ownerId: run.ownerId,
    })
    .from(run)
    .where(eq(run.status, 'queued'))
    .orderBy(asc(run.createdAt))
    .limit(10);

  const stale = await db
    .select({
      runId: run.id,
      threadId: run.threadId,
      ownerId: run.ownerId,
    })
    .from(run)
    .where(and(eq(run.status, 'running'), lt(run.updatedAt, before)))
    .limit(10);

  return { queued, stale };
}

function reason(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === 'string') {
    return cause;
  }

  return JSON.stringify(cause) ?? String(cause);
}
