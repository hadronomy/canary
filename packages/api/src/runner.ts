import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';

import { stream, type Chat, type Piece } from '@canary/agents';
import { db } from '@canary/db';
import { event, message, part, run, thread } from '@canary/db/schema/app';

type Ref = {
  ownerId: string;
  runId: string;
  threadId: string;
};

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
let boot: Promise<void> | undefined;
let last = 0;

export function start(ref: Ref) {
  runOne(ref).catch((err: unknown) => {
    fail(ref, err).catch((cause: unknown) => {
      console.error('Agent run failure could not be persisted.', cause);
    });
  });
}

export function recover() {
  if (boot || Date.now() - last < gap) {
    return;
  }

  last = Date.now();
  boot = recoverRuns().finally(() => {
    boot = undefined;
  });
}

export async function cancel(ref: Ref) {
  await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(run.id, ref.runId),
          eq(run.ownerId, ref.ownerId),
          inArray(run.status, ['queued', 'running']),
        ),
      )
      .returning();

    const row = rows[0];

    if (!row) {
      return;
    }

    await client
      .update(part)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(part.runId, row.id),
          eq(part.ownerId, ref.ownerId),
          inArray(part.status, ['pending', 'running']),
        ),
      );

    await client
      .insert(event)
      .values({
        runId: row.id,
        threadId: row.threadId,
        ownerId: ref.ownerId,
        seq: 99_999,
        type: 'run.cancelled',
      })
      .onConflictDoNothing({
        target: [event.runId, event.seq],
      });
  });
}

async function runOne(ref: Ref) {
  const row = await claim(ref);

  if (!row) {
    return;
  }

  const sink = writer(ref);
  const rows = await db
    .select({
      role: message.role,
      content: message.content,
    })
    .from(message)
    .where(and(eq(message.threadId, ref.threadId), eq(message.ownerId, ref.ownerId)))
    .orderBy(desc(message.createdAt))
    .limit(24);

  await stream({
    ...ref,
    messages: rows.reverse() as Chat[],
    piece: sink.piece,
    finish: sink.finish,
    fail: async (err) => {
      await sink.flush();
      await fail(ref, err);
    },
  });
}

async function claim(ref: Ref) {
  return await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(and(eq(run.id, ref.runId), eq(run.ownerId, ref.ownerId), eq(run.status, 'queued')))
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

    if (!(await live())) {
      return;
    }

    await db
      .transaction(async (client) => {
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

        await client
          .update(run)
          .set({ updatedAt: new Date() })
          .where(
            and(eq(run.id, ref.runId), eq(run.ownerId, ref.ownerId), eq(run.status, 'running')),
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

  async function live() {
    const rows = await db
      .select({ status: run.status })
      .from(run)
      .where(and(eq(run.id, ref.runId), eq(run.ownerId, ref.ownerId)))
      .limit(1);

    return rows[0]?.status === 'running';
  }

  async function piece(input: Piece) {
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

    edge();
    const row = slot(`error:${log}`, {
      kind: 'error',
      status: 'failed',
      content: input.message,
      data: null,
      toolName: null,
    });
    push(row);
  }

  async function finish(text: string, data: Record<string, unknown>) {
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
          and(
            eq(run.id, ref.runId),
            eq(run.ownerId, ref.ownerId),
            inArray(run.status, ['queued', 'running']),
          ),
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
        .where(and(eq(thread.id, ref.threadId), eq(thread.ownerId, ref.ownerId)));

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

  return { piece, flush, finish };
}

async function fail(ref: Ref, cause: unknown) {
  const err = cause instanceof Error ? cause.message : String(cause);

  await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'failed',
        error: err,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(run.id, ref.runId),
          eq(run.ownerId, ref.ownerId),
          inArray(run.status, ['queued', 'running']),
        ),
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
        and(
          eq(part.runId, ref.runId),
          eq(part.ownerId, ref.ownerId),
          inArray(part.status, ['pending', 'running']),
        ),
      );

    await client
      .insert(event)
      .values({
        runId: ref.runId,
        threadId: ref.threadId,
        ownerId: ref.ownerId,
        seq: 99_998,
        type: 'run.failed',
        data: { error: err },
      })
      .onConflictDoNothing({
        target: [event.runId, event.seq],
      });
  });
}

async function recoverRuns() {
  const stale = new Date(Date.now() - ttl);
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

  queued.forEach((row) => {
    start(row);
  });

  const rows = await db
    .select({
      runId: run.id,
      threadId: run.threadId,
      ownerId: run.ownerId,
    })
    .from(run)
    .where(and(eq(run.status, 'running'), lt(run.updatedAt, stale)))
    .limit(10);

  await Promise.all(rows.map((row) => fail(row, new Error('Agent runner recovered stale run.'))));
}
