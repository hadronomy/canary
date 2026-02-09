import { instrumentDrizzleClient } from "@kubiks/otel-drizzle";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
export { and, eq, inArray, sql } from "drizzle-orm";

import { env } from "@canary/env/server";

import * as schema from "./schema/index";

function getDatabaseTelemetryConfig(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      dbSystem: "postgresql" as const,
      dbName: parsed.pathname.replace(/^\//, "") || undefined,
      peerName: parsed.hostname || undefined,
      peerPort: parsed.port ? Number(parsed.port) : undefined,
      captureQueryText: process.env.DB_OTEL_CAPTURE_QUERY_TEXT === "true",
      maxQueryTextLength: 2000,
    };
  } catch {
    return {
      dbSystem: "postgresql" as const,
      captureQueryText: process.env.DB_OTEL_CAPTURE_QUERY_TEXT === "true",
      maxQueryTextLength: 2000,
    };
  }
}

export const db = instrumentDrizzleClient(
  drizzle(env.DATABASE_URL, { schema }),
  getDatabaseTelemetryConfig(env.DATABASE_URL),
);

export type Database = BunSQLDatabase<typeof schema>;

export const withTransaction = async <T>(callback: (trx: Database) => Promise<T>): Promise<T> => {
  return await db.transaction(async (trx) => {
    return await callback(trx as Database);
  });
};
