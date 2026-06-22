import { MastraServerCache } from '@mastra/core/cache';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@canary/db';
import { cache as rows, cacheCounter as counters, cacheList as lists } from '@canary/db/schema/app';

export class PostgresCache extends MastraServerCache {
  constructor() {
    super({ name: 'PostgresCache' });
  }

  async get(key: string) {
    const res = await db.select().from(rows).where(eq(rows.key, key)).limit(1);
    const row = res[0];

    if (!row) {
      return undefined;
    }

    if (row.expiresAt && row.expiresAt <= new Date()) {
      await this.delete(key);
      return undefined;
    }

    return row.value;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const expiresAt = ttl && ttl > 0 ? new Date(Date.now() + ttl) : null;

    await db
      .insert(rows)
      .values({
        key,
        value: json(value),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: rows.key,
        set: {
          value: json(value),
          expiresAt,
          updatedAt: new Date(),
        },
      });
  }

  async listLength(key: string) {
    const res = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from agent_cache_list where key = ${key}`,
    );

    return Number(res.rows[0]?.count ?? 0);
  }

  async listPush(key: string, value: unknown) {
    await db.execute(
      sql`
        insert into agent_cache_list (key, idx, value)
        values (
          ${key},
          (select coalesce(max(idx) + 1, 0) from agent_cache_list where key = ${key}),
          ${JSON.stringify(json(value))}::jsonb
        )
      `,
    );
  }

  async listFromTo(key: string, from: number, to = -1) {
    const where =
      to === -1
        ? and(eq(lists.key, key), gte(lists.idx, from))
        : and(eq(lists.key, key), gte(lists.idx, from), lte(lists.idx, to));

    const res = await db.select({ value: lists.value }).from(lists).where(where).orderBy(lists.idx);

    return res.map((row) => row.value);
  }

  async delete(key: string) {
    await Promise.all([
      db.delete(rows).where(eq(rows.key, key)),
      db.delete(lists).where(eq(lists.key, key)),
      db.delete(counters).where(eq(counters.key, key)),
    ]);
  }

  async clear() {
    await Promise.all([db.delete(rows), db.delete(lists), db.delete(counters)]);
  }

  async increment(key: string) {
    const res = await db.execute<{ value: number }>(
      sql`
        insert into agent_cache_counter (key, value)
        values (${key}, 1)
        on conflict (key) do update
        set value = agent_cache_counter.value + 1
        returning value
      `,
    );

    return Number(res.rows[0]?.value ?? 1);
  }
}

function json(value: unknown) {
  return value === undefined ? null : value;
}
