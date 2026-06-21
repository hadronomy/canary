import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, txid } from '@canary/db';
import { message, thread } from '@canary/db/schema/app';

import { protectedProcedure } from '../index';

export const messageRouter = {
  send: protectedProcedure
    .input(
      z.object({
        id: z.uuid().optional(),
        threadId: z.uuid(),
        content: z.string().trim().min(1).max(64_000),
      }),
    )
    .handler(async ({ context, input }) => {
      return await db.transaction(async (client) => {
        const rows = await client
          .select({ id: thread.id })
          .from(thread)
          .where(
            and(
              eq(thread.id, input.threadId),
              eq(thread.ownerId, context.session.user.id),
              isNull(thread.archivedAt),
            ),
          )
          .limit(1);

        if (!rows[0]) {
          throw new Error('Thread not found');
        }

        const sent = await client
          .insert(message)
          .values({
            id: input.id,
            threadId: input.threadId,
            ownerId: context.session.user.id,
            role: 'user',
            content: input.content,
          })
          .returning();

        await client
          .update(thread)
          .set({ updatedAt: new Date() })
          .where(eq(thread.id, input.threadId));

        return {
          message: sent[0] ?? null,
          txid: await txid(client),
        };
      });
    }),
};
