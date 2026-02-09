import { instrumentDrizzleClient } from "@kubiks/otel-drizzle";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
export { and, eq, inArray, sql } from "drizzle-orm";

import { loadDatabaseClientConfig } from "./config";
import * as schema from "./schema/index";

const config = loadDatabaseClientConfig();

const poolConfig = {
  url: config.databaseUrl,
  max: config.poolMax,
  idleTimeout: config.poolIdleTimeout,
  connectionTimeout: config.poolConnectionTimeout,
};

function getDatabaseTelemetryConfig(databaseUrl: string, captureQueryText: boolean) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      dbSystem: "postgresql" as const,
      dbName: parsed.pathname.replace(/^\//, "") || undefined,
      peerName: parsed.hostname || undefined,
      peerPort: parsed.port ? Number(parsed.port) : undefined,
      captureQueryText,
      maxQueryTextLength: 2000,
    };
  } catch {
    return {
      dbSystem: "postgresql" as const,
      captureQueryText,
      maxQueryTextLength: 2000,
    };
  }
}

export const db = instrumentDrizzleClient(
  drizzle({ connection: poolConfig, schema }),
  getDatabaseTelemetryConfig(config.databaseUrl, config.captureQueryText),
);

export type Database = BunSQLDatabase<typeof schema>;

export const withTransaction = async <T>(callback: (trx: Database) => Promise<T>): Promise<T> => {
  return await db.transaction(async (trx) => {
    return await callback(trx as Database);
  });
};
