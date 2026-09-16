import { and, asc, desc, eq, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import {
  Cause,
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  FiberMap,
  Layer,
  Schedule,
  Schema,
  Stream,
  SynchronizedRef,
} from 'effect';

import * as Agent from '@canary/api/agent';
import * as Database from '@canary/api/database';
import { own } from '@canary/api/scope';
import { txid } from '@canary/db';
import { event, message, part, run, thread } from '@canary/db/schema/app';

const Uuid = Schema.String.check(Schema.isUUID());

export const RunId = Uuid.pipe(Schema.brand('RunId'));
export const ThreadId = Uuid.pipe(Schema.brand('ThreadId'));
export const MessageId = Uuid.pipe(Schema.brand('MessageId'));
export const OwnerId = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand('OwnerId'));
export const RunStatus = Schema.Literals(['queued', 'running', 'completed', 'cancelled', 'failed']);
export const PartStatus = Schema.Literals([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const PartKind = Schema.Literals([
  'text',
  'reasoning',
  'tool-call',
  'tool-result',
  'artifact',
  'error',
  'status',
]);

const Fields = Schema.Record(Schema.String, Schema.Unknown);

export const MessageRow = Schema.Struct({
  id: MessageId,
  threadId: ThreadId,
  ownerId: OwnerId,
  runId: Schema.NullOr(RunId),
  role: Schema.Literals(['user', 'assistant', 'system', 'tool']),
  content: Schema.String,
  metadata: Schema.NullOr(Fields),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export const RunRow = Schema.Struct({
  id: RunId,
  threadId: ThreadId,
  ownerId: OwnerId,
  inputMessageId: Schema.NullOr(MessageId),
  status: RunStatus,
  model: Schema.String,
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Date),
  completedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export const ThreadRow = Schema.Struct({
  id: ThreadId,
  ownerId: OwnerId,
  title: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  archivedAt: Schema.NullOr(Schema.Date),
});
export const Sent = Schema.Struct({ message: MessageRow, run: RunRow, txid: Schema.Int });
export const Cancelled = Schema.Struct({ run: Schema.NullOr(RunRow), txid: Schema.Int });
export const Archived = Schema.Struct({ thread: Schema.NullOr(ThreadRow), txid: Schema.Int });

export const RunEvent = Schema.TaggedUnion({
  Queued: { model: Schema.String },
  Started: { model: Schema.String },
  Part: { partSeq: Schema.Int, kind: PartKind, status: PartStatus },
  Completed: { data: Fields },
  Failed: { error: Schema.String },
  Cancelled: {},
});

export const Send = Schema.Struct({
  content: Schema.String.check(Schema.isMinLength(1)),
  id: Schema.optional(MessageId),
  owner: OwnerId,
  threadId: ThreadId,
});
export const Key = Schema.Struct({ id: RunId, owner: OwnerId });
export const ThreadKey = Schema.Struct({ id: ThreadId, owner: OwnerId });

export type RunId = typeof RunId.Type;
export type ThreadId = typeof ThreadId.Type;
export type Send = typeof Send.Type;
export type Key = typeof Key.Type;
export type ThreadKey = typeof ThreadKey.Type;
export type Sent = typeof Sent.Type;
export type Cancelled = typeof Cancelled.Type;
export type Archived = typeof Archived.Type;
export type RunEvent = typeof RunEvent.Type;

const Ref = Schema.Struct({ ownerId: OwnerId, runId: RunId, threadId: ThreadId });
type Ref = typeof Ref.Type;
type Row = typeof run.$inferSelect;
type Client = Parameters<Parameters<(typeof import('@canary/db'))['db']['transaction']>[0]>[0];
type Log = {
  item: RunEvent;
  ownerId: string;
  runId: string;
  threadId: string;
};
type Draft = {
  content: string;
  data: Record<string, unknown> | null;
  kind: typeof PartKind.Type;
  seq: number;
  status: typeof PartStatus.Type;
  toolName: string | null;
};
type Outcome = Data.TaggedEnum<{
  Finished: { readonly text: string; readonly data: Record<string, unknown> };
  Failed: { readonly error: string };
}>;
const Outcome = Data.taggedEnum<Outcome>();
type State = {
  dirty: Map<number, Draft>;
  log: number;
  next: number;
  outcome: Outcome | null;
  seg: number;
  slots: Map<string, Draft>;
  texts: Map<string, string>;
};

export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()('ThreadNotFound', {
  id: ThreadId,
}) {}

export interface Interface {
  readonly send: (input: Send) => Effect.Effect<Sent, ThreadNotFound | Database.Failure>;
  readonly cancel: (input: Key) => Effect.Effect<Cancelled, Database.Failure>;
  readonly archive: (input: ThreadKey) => Effect.Effect<Archived, Database.Failure>;
}

export class Service extends Context.Service<Service, Interface>()('@canary/api/Run') {}

function millis(name: string, value: number) {
  return Config.Number(name).pipe(Config.withDefault(value), Config.map(Duration.millis));
}

const settings = Config.all({
  batch: Config.Number('RUN_FLUSH_BATCH').pipe(Config.withDefault(32)),
  flush: millis('RUN_FLUSH_INTERVAL', 60),
  model: Config.String('AGENT_MODEL').pipe(Config.withDefault('~moonshotai/kimi-latest')),
  recover: millis('RUN_RECOVERY_INTERVAL', 30_000),
  stale: millis('RUN_STALE_TTL', 600_000),
});

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agent = yield* Agent.Service;
    const database = yield* Database.Service;
    const cfg = yield* settings;
    const fibers = yield* FiberMap.make<RunId>();

    const execute = Effect.fn('Run.execute')(function* (ref: Ref) {
      if (!(yield* claim(database, ref))) return;

      const rows = yield* database.query('load run messages', async (db) => {
        const rows = await db
          .select({ role: message.role, content: message.content })
          .from(message)
          .where(own(message, ref.ownerId, eq(message.threadId, ref.threadId)))
          .orderBy(desc(message.createdAt))
          .limit(24);
        return rows.reverse();
      });
      const messages = yield* Schema.decodeUnknownEffect(Schema.Array(Agent.Chat))(rows);
      const state = yield* SynchronizedRef.make(initial());

      yield* agent.events({ ...ref, messages }).pipe(
        Stream.groupedWithin(cfg.batch, cfg.flush),
        Stream.runForEach((events) =>
          Effect.gen(function* () {
            yield* SynchronizedRef.modify(state, (state) => {
              events.forEach((event) => update(state, event));
              return [undefined, state] as const;
            });
            yield* flush(database, ref, state);
            const current = yield* SynchronizedRef.get(state);

            if (current.outcome?._tag === 'Finished') yield* finish(database, ref, current);
            if (current.outcome?._tag === 'Failed') {
              yield* fail(database, ref, current.outcome.error);
            }
          }),
        ),
      );
    });

    const start = Effect.fn('Run.start')((ref: Ref) =>
      FiberMap.run(
        fibers,
        ref.runId,
        execute(ref).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
            return fail(database, ref, Cause.squash(cause)).pipe(
              Effect.catchCause((next) =>
                Effect.logError('Agent run failure could not be persisted.', next),
              ),
            );
          }),
        ),
        { onlyIfMissing: true },
      ),
    );

    const halt = Effect.fn('Run.halt')((refs: readonly Ref[]) =>
      Effect.forEach(
        refs,
        (ref) =>
          Effect.gen(function* () {
            yield* agent.cancel(ref.runId).pipe(
              Effect.retry({ times: 2 }),
              Effect.timeout('5 seconds'),
              Effect.catchCause((cause) => Effect.logError('Agent cancellation failed.', cause)),
            );
            yield* FiberMap.remove(fibers, ref.runId);
          }),
        { discard: true },
      ),
    );

    const recover = Effect.fn('Run.recover')(function* () {
      const now = yield* Clock.currentTimeMillis;
      const state = yield* scan(database, new Date(now - Duration.toMillis(cfg.stale)));
      yield* Effect.forEach(state.queued, start, { discard: true });
      yield* Effect.forEach(
        state.stale,
        (ref) => fail(database, ref, new Error('Agent runner recovered stale run.')),
        { discard: true },
      );
    });

    yield* recover().pipe(
      Effect.catchCause((cause) => Effect.logError('Agent run recovery failed.', cause)),
      Effect.repeat(Schedule.spaced(cfg.recover)),
      Effect.forkScoped,
    );

    return Service.of({
      send: Effect.fn('Run.send')(function* (input) {
        const sent = yield* sending(database, cfg.model, input);
        yield* start({
          ownerId: input.owner,
          runId: sent.run.id,
          threadId: input.threadId,
        });
        return sent;
      }),
      cancel: Effect.fn('Run.cancel')((input) =>
        Effect.gen(function* () {
          const state = yield* cancelling(database, input);
          yield* halt(state.refs);
          return state.result;
        }).pipe(Effect.uninterruptible),
      ),
      archive: Effect.fn('Run.archive')((input) =>
        Effect.gen(function* () {
          const state = yield* archiving(database, input);
          yield* halt(state.refs);
          return state.result;
        }).pipe(Effect.uninterruptible),
      ),
    });
  }),
);

function sending(database: Database.Interface, model: string, input: Send) {
  return database
    .transact('send message', async (client) => {
      const rows = await client
        .select({ id: thread.id })
        .from(thread)
        .where(own(thread, input.owner, eq(thread.id, input.threadId), isNull(thread.archivedAt)))
        .limit(1);
      if (!rows[0]) return null;

      const sent = await client
        .insert(message)
        .values({
          id: input.id,
          threadId: input.threadId,
          ownerId: input.owner,
          role: 'user',
          content: input.content,
        })
        .onConflictDoNothing({ target: message.id })
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
      if (!row) throw new Error('Message insert failed.');

      const queued = await client
        .insert(run)
        .values({
          threadId: input.threadId,
          ownerId: input.owner,
          inputMessageId: row.id,
          status: 'queued',
          model,
        })
        .onConflictDoNothing({ target: run.inputMessageId })
        .returning();
      const active = await client
        .select()
        .from(run)
        .where(own(run, input.owner, eq(run.inputMessageId, row.id)))
        .limit(1);
      const item = queued[0] ?? active[0];
      if (!item) throw new Error('Run insert failed.');

      await client
        .insert(event)
        .values({
          runId: item.id,
          threadId: item.threadId,
          ownerId: input.owner,
          seq: 0,
          ...entry({ _tag: 'Queued', model }),
        })
        .onConflictDoNothing({ target: [event.runId, event.seq] });
      await client
        .update(thread)
        .set({ updatedAt: new Date() })
        .where(own(thread, input.owner, eq(thread.id, input.threadId)));

      return Schema.decodeUnknownSync(Sent)({
        message: row,
        run: item,
        txid: await txid(client),
      });
    })
    .pipe(
      Effect.flatMap((sent) =>
        sent ? Effect.succeed(sent) : Effect.fail(new ThreadNotFound({ id: input.threadId })),
      ),
    );
}

function cancelling(database: Database.Interface, input: Key) {
  return database.transact('cancel run', async (client) => {
    const rows = await client
      .update(run)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(
        own(run, input.owner, eq(run.id, input.id), inArray(run.status, ['queued', 'running'])),
      )
      .returning();
    await cancelled(client, rows);

    return {
      refs: rows.map(reference),
      result: Schema.decodeUnknownSync(Cancelled)({
        run: rows[0] ?? null,
        txid: await txid(client),
      }),
    };
  });
}

function archiving(database: Database.Interface, input: ThreadKey) {
  return database.transact('archive thread', async (client) => {
    const rows = await client
      .update(thread)
      .set({ archivedAt: new Date() })
      .where(own(thread, input.owner, eq(thread.id, input.id), isNull(thread.archivedAt)))
      .returning();
    const active = await client
      .update(run)
      .set({ status: 'cancelled', completedAt: new Date() })
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
      refs: active.map(reference),
      result: Schema.decodeUnknownSync(Archived)({
        thread: rows[0] ?? null,
        txid: await txid(client),
      }),
    };
  });
}

async function cancelled(client: Client, rows: readonly Row[]) {
  const first = rows[0];
  if (!first) return;

  const ids = rows.map((row) => row.id);
  await client
    .update(part)
    .set({ status: 'cancelled', updatedAt: new Date() })
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
      item: { _tag: 'Cancelled' },
    })),
  );
}

async function record(client: Client, rows: readonly Log[]) {
  const first = rows[0];
  if (!first) return;

  const seqs = await client
    .select({ runId: event.runId, seq: max(event.seq) })
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
        runId: row.runId,
        threadId: row.threadId,
        ownerId: row.ownerId,
        seq: (next.get(row.runId) ?? -1) + 1,
        ...entry(row.item),
      })),
    )
    .onConflictDoNothing({ target: [event.runId, event.seq] });
}

function claim(database: Database.Interface, ref: Ref) {
  return database.transact('claim run', async (client) => {
    const rows = await client
      .update(run)
      .set({ status: 'running', startedAt: new Date() })
      .where(own(run, ref.ownerId, eq(run.id, ref.runId), eq(run.status, 'queued')))
      .returning();
    const row = rows[0];
    if (!row) return null;

    await client
      .insert(event)
      .values({
        runId: row.id,
        threadId: row.threadId,
        ownerId: row.ownerId,
        seq: 1,
        ...entry({ _tag: 'Started', model: row.model }),
      })
      .onConflictDoNothing({ target: [event.runId, event.seq] });
    return row;
  });
}

function initial(): State {
  return {
    dirty: new Map(),
    log: 2,
    next: 0,
    outcome: null,
    seg: 0,
    slots: new Map(),
    texts: new Map(),
  };
}

function update(state: State, event: Agent.Event) {
  if (state.outcome) return;

  if (event._tag === 'Piece') {
    piece(state, event.piece);
    return;
  }

  if (event._tag === 'Finished') {
    edge(state);
    state.outcome = Outcome.Finished({ text: event.text, data: event.data });
    return;
  }

  state.texts.clear();
  state.slots.forEach((row) => {
    if (row.status !== 'pending' && row.status !== 'running') return;
    row.status = 'failed';
    push(state, row);
  });
  const row = slot(state, 'error:terminal', {
    kind: 'error',
    status: 'failed',
    content: event.error,
    data: null,
    toolName: null,
  });
  row.content = event.error;
  row.status = 'failed';
  push(state, row);
  state.outcome = Outcome.Failed({ error: event.error });
}

function piece(state: State, input: typeof Agent.Piece.Type) {
  if (input.type === 'text-start') {
    push(
      state,
      slot(state, text(state, input.id, true), {
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
    const row = slot(state, text(state, input.id), {
      kind: 'text',
      status: 'running',
      content: '',
      data: null,
      toolName: null,
    });
    row.content += input.text;
    push(state, row);
    return;
  }

  if (input.type === 'text-end') {
    const key = state.texts.get(input.id);
    if (!key) return;

    const row = slot(state, key, {
      kind: 'text',
      status: 'running',
      content: '',
      data: null,
      toolName: null,
    });
    row.status = 'completed';
    state.texts.delete(input.id);
    push(state, row);
    return;
  }

  if (input.type === 'reasoning-start') {
    edge(state);
    push(
      state,
      slot(state, `reasoning:${input.id}`, {
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
    edge(state);
    const row = slot(state, `reasoning:${input.id}`, {
      kind: 'reasoning',
      status: 'running',
      content: '',
      data: null,
      toolName: null,
    });
    row.content += input.text;
    push(state, row);
    return;
  }

  if (input.type === 'reasoning-end') {
    edge(state);
    const row = slot(state, `reasoning:${input.id}`, {
      kind: 'reasoning',
      status: 'running',
      content: '',
      data: null,
      toolName: null,
    });
    row.status = 'completed';
    push(state, row);
    return;
  }

  if (input.type === 'tool-call') {
    edge(state);
    push(
      state,
      slot(state, `tool:${input.id}`, {
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
    edge(state);
    const row = slot(state, `tool:${input.id}`, {
      kind: 'tool-call',
      status: 'running',
      content: '',
      data: null,
      toolName: input.name,
    });
    row.content += input.text;
    push(state, row);
    return;
  }

  edge(state);
  const row = slot(state, `tool:${input.id}`, {
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
  push(state, row);
}

function slot(state: State, key: string, init: Omit<Draft, 'seq'>) {
  const hit = state.slots.get(key);
  if (hit) return hit;

  const row = { ...init, seq: state.next };
  state.next += 1;
  state.slots.set(key, row);
  return row;
}

function text(state: State, id: string, fresh = false) {
  const hit = state.texts.get(id);
  if (hit && !fresh) return hit;
  if (hit) close(state, hit);

  const key = `text:${id}:${state.seg}`;
  state.seg += 1;
  state.texts.set(id, key);
  return key;
}

function close(state: State, key: string) {
  const row = state.slots.get(key);
  if (!row || row.kind !== 'text' || row.status !== 'running') return;

  row.status = 'completed';
  push(state, row);
}

function edge(state: State) {
  state.texts.forEach((key) => close(state, key));
  state.texts.clear();
}

function push(state: State, row: Draft) {
  state.dirty.set(row.seq, row);
}

function flush(
  database: Database.Interface,
  ref: Ref,
  state: SynchronizedRef.SynchronizedRef<State>,
) {
  return SynchronizedRef.modifyEffect(state, (state) => {
    const rows = [...state.dirty.values()].map((row) => ({ ...row }));
    if (!rows.length) return Effect.succeed([undefined, state] as const);

    const log = state.log;
    return database
      .transact('flush run parts', async (client) => {
        const active = await client
          .update(run)
          .set({ updatedAt: new Date() })
          .where(own(run, ref.ownerId, eq(run.id, ref.runId), eq(run.status, 'running')))
          .returning();
        if (!active[0]) return;

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
        await client
          .insert(event)
          .values(
            rows.map((row, index) => ({
              runId: ref.runId,
              threadId: ref.threadId,
              ownerId: ref.ownerId,
              seq: log + index,
              ...entry({
                _tag: 'Part',
                partSeq: row.seq,
                kind: row.kind,
                status: row.status,
              }),
            })),
          )
          .onConflictDoNothing({ target: [event.runId, event.seq] });
      })
      .pipe(
        Effect.retry({ times: 2 }),
        Effect.map(() => {
          rows.forEach((row) => state.dirty.delete(row.seq));
          state.log += rows.length;
          return [undefined, state] as const;
        }),
      );
  });
}

function finish(database: Database.Interface, ref: Ref, state: State) {
  const outcome = state.outcome;
  if (outcome?._tag !== 'Finished') return Effect.void;

  const body =
    outcome.text ||
    [...state.slots.values()]
      .filter((row) => row.kind === 'text')
      .toSorted((a, b) => a.seq - b.seq)
      .map((row) => row.content)
      .join('');

  return database.transact('finish run', async (client) => {
    const rows = await client
      .update(run)
      .set({ status: 'completed', completedAt: new Date() })
      .where(
        own(run, ref.ownerId, eq(run.id, ref.runId), inArray(run.status, ['queued', 'running'])),
      )
      .returning();
    if (!rows[0]) return;

    const sent = await client
      .insert(message)
      .values({
        threadId: ref.threadId,
        ownerId: ref.ownerId,
        runId: ref.runId,
        role: 'assistant',
        content: body,
        metadata: outcome.data,
      })
      .returning();
    const item = sent[0];
    if (item) {
      await client
        .update(part)
        .set({ messageId: item.id, updatedAt: new Date() })
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
        seq: state.log,
        ...entry({ _tag: 'Completed', data: outcome.data }),
      })
      .onConflictDoNothing({ target: [event.runId, event.seq] });
  });
}

function fail(database: Database.Interface, ref: Ref, cause: unknown) {
  const error = reason(cause);
  return database.transact('fail run', async (client) => {
    const rows = await client
      .update(run)
      .set({ status: 'failed', error, completedAt: new Date() })
      .where(
        own(run, ref.ownerId, eq(run.id, ref.runId), inArray(run.status, ['queued', 'running'])),
      )
      .returning();
    if (!rows[0]) return;

    await client
      .update(part)
      .set({ status: 'failed', updatedAt: new Date() })
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
        item: { _tag: 'Failed', error },
      },
    ]);
  });
}

function scan(database: Database.Interface, before: Date) {
  return database.query('recover runs', async (db) => {
    const queued = await db
      .select({ runId: run.id, threadId: run.threadId, ownerId: run.ownerId })
      .from(run)
      .where(eq(run.status, 'queued'))
      .orderBy(asc(run.createdAt))
      .limit(10);
    const stale = await db
      .select({ runId: run.id, threadId: run.threadId, ownerId: run.ownerId })
      .from(run)
      .where(and(eq(run.status, 'running'), lt(run.updatedAt, before)))
      .limit(10);

    return {
      queued: Schema.decodeUnknownSync(Schema.Array(Ref))(queued),
      stale: Schema.decodeUnknownSync(Schema.Array(Ref))(stale),
    };
  });
}

function reference(row: Row): Ref {
  return Schema.decodeUnknownSync(Ref)({
    ownerId: row.ownerId,
    runId: row.id,
    threadId: row.threadId,
  });
}

function entry(input: RunEvent) {
  const item = Schema.decodeUnknownSync(RunEvent)(input);

  switch (item._tag) {
    case 'Queued':
      return { type: 'run.queued', data: { model: item.model } };
    case 'Started':
      return { type: 'run.started', data: { model: item.model } };
    case 'Part':
      return {
        type: 'message.part',
        data: { partSeq: item.partSeq, kind: item.kind, status: item.status },
      };
    case 'Completed':
      return { type: 'run.completed', data: item.data };
    case 'Failed':
      return { type: 'run.failed', data: { error: item.error } };
    case 'Cancelled':
      return { type: 'run.cancelled', data: undefined };
  }
}

function reason(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return JSON.stringify(cause) ?? String(cause);
}
