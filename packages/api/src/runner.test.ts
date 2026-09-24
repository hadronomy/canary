import { it } from '@effect/vitest';
import { Deferred, Effect, Layer, Schema } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import { beforeEach, describe, expect, vi } from 'vitest';

vi.mock('@canary/agents', () => import('@canary/api/test/agent'));
vi.mock('@canary/db', async () => {
  const fixture = await import('@canary/api/test/database');
  return { db: fixture.db, txid: () => Promise.resolve(1) };
});

import * as Agent from '@canary/api/agent';
import * as Database from '@canary/api/database';
import * as Run from '@canary/api/runner';
import { reset as resetAgent, state as agent } from '@canary/api/test/agent';
import { ids, reset as resetDatabase, state as database } from '@canary/api/test/database';

const deps = Layer.merge(Agent.layer, Database.layer);
const layer = Run.layer.pipe(Layer.provide(deps));

describe('Run', () => {
  beforeEach(() => {
    resetAgent();
    resetDatabase();
  });

  it.effect('starts and completes one run', () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const result = yield* Run.Service.use((run) => run.send(send()));
        yield* Deferred.await(agent.stopped);

        expect(result.message).toMatchObject({
          content: 'hello',
          id: ids.message,
          ownerId: ids.owner,
          threadId: ids.thread,
        });
        expect(result.run).toMatchObject({ id: ids.run, status: 'queued' });
        expect(result.txid).toBe(1);
        expect(agent.calls).toBe(1);
        expect(agent.cleanups).toBe(1);
        expect(database.run.status).toBe('completed');
        expect(database.parts).toEqual([
          expect.objectContaining({ content: 'ok', kind: 'text', status: 'completed' }),
        ]);
      }).pipe(Effect.provide(layer));

      expect(database.closed).toBe(1);
    }),
  );

  it.effect('creates a thread in one transaction', () =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Run.Create)({
        id: ids.thread,
        owner: ids.owner,
        title: 'Created thread',
      });
      const result = yield* Run.Service.use((run) => run.create(input)).pipe(Effect.provide(layer));

      expect(result.thread).toMatchObject({
        id: ids.thread,
        ownerId: ids.owner,
        title: 'Created thread',
      });
      expect(result.txid).toBe(1);
    }),
  );

  it.effect('does not start a duplicate run', () =>
    Effect.gen(function* () {
      agent.mode = 'hold';

      yield* Effect.gen(function* () {
        const run = yield* Run.Service;
        yield* run.send(send());
        yield* Deferred.await(agent.started);
        yield* run.send(send());

        expect(agent.calls).toBe(1);

        yield* run.cancel(key());
        yield* Deferred.await(agent.stopped);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('flushes an active part on the configured interval', () =>
    Effect.gen(function* () {
      agent.mode = 'hold';

      yield* Effect.gen(function* () {
        const run = yield* Run.Service;
        yield* run.send(send());
        yield* Deferred.await(agent.started);
        agent.input?.piece({ type: 'text-start', id: 'draft' });
        agent.input?.piece({ type: 'text-delta', id: 'draft', text: 'working' });
        yield* Effect.yieldNow;
        yield* TestClock.adjust('60 millis');

        expect(database.parts).toEqual([
          expect.objectContaining({ content: 'working', kind: 'text', status: 'running' }),
        ]);

        yield* run.cancel(key());
        yield* Deferred.await(agent.stopped);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('cancels the provider and blocks late writes', () =>
    Effect.gen(function* () {
      agent.mode = 'hold';

      yield* Effect.gen(function* () {
        const run = yield* Run.Service;
        yield* run.send(send());
        yield* Deferred.await(agent.started);

        const result = yield* run.cancel(key());
        yield* Deferred.await(agent.stopped);
        agent.input?.piece({ type: 'text-delta', id: 'late', text: 'ignored' });
        yield* Effect.yieldNow;

        expect(result.run).toMatchObject({ id: ids.run, status: 'cancelled' });
        expect(agent.cancels).toBe(1);
        expect(agent.cleanups).toBe(1);
        expect(database.parts).toEqual([]);
        expect(database.events.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('settles a thread without stopping its run', () =>
    Effect.gen(function* () {
      agent.mode = 'hold';

      yield* Effect.gen(function* () {
        const run = yield* Run.Service;
        yield* run.send(send());
        yield* Deferred.await(agent.started);

        const result = yield* run.settle(settle(true));

        expect(result.thread).toMatchObject({ id: ids.thread, ownerId: ids.owner });
        expect(result.thread?.settledAt).toBeInstanceOf(Date);
        expect(result.thread?.snoozedUntil).toBeNull();
        expect(agent.cancels).toBe(0);
        expect(database.run.status).toBe('running');
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('snoozes a thread until a given time', () =>
    Effect.gen(function* () {
      const until = new Date(Date.now() + 3_600_000);
      const result = yield* Run.Service.use((run) => run.snooze(snooze(until))).pipe(
        Effect.provide(layer),
      );

      expect(result.thread?.snoozedUntil).toEqual(until);
      expect(result.thread?.settledAt).toBeNull();
    }),
  );

  it.effect('picks a filed thread back up when a message is sent', () =>
    Effect.gen(function* () {
      database.thread.settledAt = new Date();
      database.thread.snoozedUntil = new Date(Date.now() + 3_600_000);

      yield* Run.Service.use((run) => run.send(send())).pipe(Effect.provide(layer));

      expect(database.thread.settledAt).toBeNull();
      expect(database.thread.snoozedUntil).toBeNull();
    }),
  );

  it.effect('persists a provider failure once', () =>
    Effect.gen(function* () {
      agent.mode = 'fail';

      yield* Effect.gen(function* () {
        yield* Run.Service.use((run) => run.send(send()));
        yield* Deferred.await(agent.stopped);

        expect(database.run).toMatchObject({ error: 'provider failed', status: 'failed' });
        expect(database.parts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ content: 'partial', status: 'failed' }),
            expect.objectContaining({ content: 'provider failed', kind: 'error' }),
          ]),
        );
        expect(database.events.filter((event) => event.type === 'run.failed')).toHaveLength(1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('cancels an active provider when the layer closes', () =>
    Effect.gen(function* () {
      agent.mode = 'hold';

      yield* Effect.gen(function* () {
        yield* Run.Service.use((run) => run.send(send()));
        yield* Deferred.await(agent.started);
      }).pipe(Effect.provide(layer));

      expect(agent.cancels).toBe(1);
      expect(agent.cleanups).toBe(1);
      expect(database.closed).toBe(1);
    }),
  );

  it.effect('recovers a queued run once', () =>
    Effect.gen(function* () {
      database.queued = [{ runId: ids.run, ownerId: ids.owner, threadId: ids.thread }];

      yield* Effect.gen(function* () {
        yield* Run.Service;
        yield* Deferred.await(agent.stopped);
        yield* TestClock.adjust('30 seconds');
        yield* Effect.yieldNow;

        expect(agent.calls).toBe(1);
        expect(database.run.status).toBe('completed');
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('fails a stale run once', () =>
    Effect.gen(function* () {
      resetDatabase('running');
      database.stale = [{ runId: ids.run, ownerId: ids.owner, threadId: ids.thread }];

      yield* Effect.gen(function* () {
        yield* Run.Service;
        yield* Deferred.await(database.failed);
        yield* TestClock.adjust('30 seconds');
        yield* Effect.yieldNow;

        expect(database.run).toMatchObject({
          error: 'Agent runner recovered stale run.',
          status: 'failed',
        });
        expect(database.events.filter((event) => event.type === 'run.failed')).toHaveLength(1);
        expect(agent.calls).toBe(0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('returns a typed error for a thread it cannot see', () =>
    Effect.gen(function* () {
      database.missing = true;

      const error = yield* Run.Service.use((run) => run.send(send())).pipe(
        Effect.flip,
        Effect.provide(layer),
      );

      expect(error._tag).toBe('ThreadNotFound');
      if (error._tag === 'ThreadNotFound') expect(error.id).toBe(ids.thread);
    }),
  );
});

function send() {
  return Schema.decodeUnknownSync(Run.Send)({
    content: 'hello',
    id: ids.message,
    owner: ids.owner,
    threadId: ids.thread,
  });
}

function key() {
  return Schema.decodeUnknownSync(Run.Key)({ id: ids.run, owner: ids.owner });
}

function settle(settled: boolean) {
  return Schema.decodeUnknownSync(Run.Settle)({ id: ids.thread, owner: ids.owner, settled });
}

function snooze(until: Date | null) {
  return Schema.decodeUnknownSync(Run.Snooze)({ id: ids.thread, owner: ids.owner, until });
}
