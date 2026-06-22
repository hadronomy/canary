import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db, txid } from '@canary/db';
import { event, part, run } from '@canary/db/schema/app';

import { protectedProcedure } from '../index';

export const runRouter = {
  cancel: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      return await db.transaction(async (client) => {
        const rows = await client
          .update(run)
          .set({
            status: 'cancelled',
            completedAt: new Date(),
          })
          .where(
            and(
              eq(run.id, input.id),
              eq(run.ownerId, context.session.user.id),
              inArray(run.status, ['queued', 'running']),
            ),
          )
          .returning();

        const row = rows[0];

        if (row) {
          await client
            .update(part)
            .set({
              status: 'cancelled',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(part.runId, row.id),
                eq(part.ownerId, context.session.user.id),
                inArray(part.status, ['pending', 'running']),
              ),
            );

          await client
            .insert(event)
            .values({
              runId: row.id,
              threadId: row.threadId,
              ownerId: context.session.user.id,
              seq: 99_999,
              type: 'run.cancelled',
            })
            .onConflictDoNothing({
              target: [event.runId, event.seq],
            });
        }

        return {
          run: row ?? null,
          txid: await txid(client),
        };
      });
    }),
};
