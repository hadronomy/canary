import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
export { and, eq, inArray, sql } from "drizzle-orm";

import { env } from "@canary/env/server";

import * as schema from "./schema/index";

export const db = drizzle(env.DATABASE_URL, { schema });

export type Database = BunSQLDatabase<typeof schema>;

export const withTransaction = async <T>(callback: (trx: Database) => Promise<T>): Promise<T> => {
  return await db.transaction(async (trx) => {
    return await callback(trx as Database);
  });
};
