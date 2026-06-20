import { db, txid } from '@canary/db';
import { member, thread } from '@canary/db/schema/app';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { protectedProcedure } from '../index';

export const threadRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return await db
      .select()
      .from(thread)
      .where(and(eq(thread.ownerId, context.session.user.id), isNull(thread.archivedAt)))
      .orderBy(desc(thread.updatedAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      const rows = await db
        .select()
        .from(thread)
        .where(and(eq(thread.id, input.id), eq(thread.ownerId, context.session.user.id)))
        .limit(1);

      return rows[0] ?? null;
    }),

  create: protectedProcedure
    .input(z.object({ title: z.string().trim().min(1).max(120).optional() }).optional())
    .handler(async ({ context, input }) => {
      return await db.transaction(async (client) => {
        const rows = await client
          .insert(thread)
          .values({
            ownerId: context.session.user.id,
            title: input?.title ?? 'New thread',
          })
          .returning();

        const row = rows[0];

        if (!row) {
          throw new Error('Thread insert failed');
        }

        await client.insert(member).values({
          threadId: row.id,
          userId: context.session.user.id,
        });

        return {
          thread: row,
          txid: await txid(client),
        };
      });
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      return await db.transaction(async (client) => {
        const rows = await client
          .update(thread)
          .set({ archivedAt: new Date() })
          .where(and(eq(thread.id, input.id), eq(thread.ownerId, context.session.user.id)))
          .returning();

        return {
          thread: rows[0] ?? null,
          txid: await txid(client),
        };
      });
    }),
};
