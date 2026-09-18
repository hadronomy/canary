import { and, eq, type AnyColumn, type SQL } from '@canary/db/query';

// Single owner guard for the api Module.
// The auth middleware in index.ts rejects missing sessions.
// Routers use own so no query builds eq(ownerId) by hand.
export function own(
  table: { ownerId: AnyColumn },
  owner: string,
  ...rest: (SQL | undefined)[]
): SQL | undefined {
  return and(eq(table.ownerId, owner), ...rest);
}
