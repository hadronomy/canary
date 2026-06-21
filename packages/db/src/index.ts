import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { env } from '@canary/env/server';

import * as schema from './schema';

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

export async function txid(client: Pick<typeof db, 'execute'>) {
  const res = await client.execute<{ txid: string }>(
    sql`select pg_current_xact_id()::xid::text as txid`,
  );

  return Number(res.rows[0]?.txid ?? 0);
}
