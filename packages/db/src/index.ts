import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import { ENV } from '@canary/db/env';

import * as schema from './schema';

export function createDb() {
  return drizzle(ENV.DATABASE_URL, { schema });
}

export const db = createDb();

export async function txid(client: Pick<typeof db, 'execute'>) {
  const res = await client.execute<{ txid: string }>(
    sql`select pg_current_xact_id()::xid::text as txid`,
  );

  return Number(res.rows[0]?.txid ?? 0);
}
