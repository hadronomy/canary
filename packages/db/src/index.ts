import { drizzle } from "drizzle-orm/bun-sql";
export { and, eq, inArray, sql } from "drizzle-orm";

import { loadDatabaseClientConfig } from "./config";
import * as schema from "./schema/index";
import { relations } from "./schema/relations";

const config = loadDatabaseClientConfig();

const poolConfig = {
  url: config.databaseUrl,
  max: config.poolMax,
  idleTimeout: config.poolIdleTimeout,
  connectionTimeout: config.poolConnectionTimeout,
};

export const db = drizzle({ connection: poolConfig, schema, relations });

export type Database = typeof db;
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const withTransaction = async <T>(
  callback: (trx: DatabaseTransaction) => Promise<T>,
): Promise<T> => {
  return await db.transaction(async (trx) => {
    return await callback(trx);
  });
};
