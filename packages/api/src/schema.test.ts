import { describe, expect, expectTypeOf, it } from 'vitest';

import { getColumns } from '@canary/db/query';
import { Replica } from '@canary/db/replica';
import { manifest } from '@canary/db/replica/manifest';
import { message } from '@canary/db/schema/app';

describe('shared database schema', () => {
  it('derives the Electric row and columns from Drizzle', () => {
    const row = Replica.Message.schema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      threadId: '00000000-0000-4000-8000-000000000002',
      ownerId: 'user-1',
      runId: null,
      role: 'user',
      content: 'hello',
      metadata: { source: 'test' },
      createdAt: '2026-09-17 10:00:00+00',
      updatedAt: '2026-09-17 10:00:00+00',
    });

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.metadata).toEqual({ source: 'test' });
    expectTypeOf(row).toEqualTypeOf<Replica.Message>();
    expect(Object.keys(Replica.Message.schema.shape)).toContain('threadId');
    expect(Replica.Message.columns).toEqual(
      Object.values(getColumns(message)).map((column) => column.name),
    );
    expect(Replica.Message.columns).toContain('thread_id');
  });

  it('composes each replica with its generated cache version', () => {
    expect(Replica.has('messages')).toBe(true);
    expect(Replica.has('unknown')).toBe(false);
    expect(Replica.get('messages')).toBe(Replica.Message);
    expectTypeOf(Replica.get('messages').name).toEqualTypeOf<'messages'>();

    for (const replica of Object.values(Replica.all)) {
      expect(Number.isSafeInteger(replica.cacheVersion)).toBe(true);
      expect(replica.cacheVersion).toBeGreaterThan(0);
      expect(manifest.replicas[replica.name].cacheVersion).toBe(replica.cacheVersion);
    }
  });

  it('records a complete Drizzle migration graph', () => {
    expect(manifest.database.head.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifest.database.head.sqlDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.database.head.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.database.historyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.database.history).toContainEqual(manifest.database.head);

    const ids = new Set(manifest.database.history.map((entry) => entry.snapshotId));

    for (const entry of manifest.database.history) {
      for (const parent of entry.prevIds) {
        expect(parent === '00000000-0000-0000-0000-000000000000' || ids.has(parent)).toBe(true);
      }
    }
  });
});
