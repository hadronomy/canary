import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, txid } from '@canary/db';
import { event, message, run, thread } from '@canary/db/schema/app';
import { env } from '@canary/env/server';

import { protectedProcedure } from '../index';
import { start } from '../runner';

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
      const res = await db.transaction(async (client) => {
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
          .onConflictDoNothing({
            target: message.id,
          })
          .returning();
        const found = input.id
          ? await client
              .select()
              .from(message)
              .where(
                and(
                  eq(message.id, input.id),
                  eq(message.ownerId, context.session.user.id),
                  eq(message.threadId, input.threadId),
                ),
              )
              .limit(1)
          : [];
        const row = sent[0] ?? found[0];

        if (!row) {
          throw new Error('Message insert failed');
        }

        const queued = await client
          .insert(run)
          .values({
            threadId: input.threadId,
            ownerId: context.session.user.id,
            inputMessageId: row.id,
            status: 'queued',
            model: env.AGENT_MODEL,
          })
          .onConflictDoNothing({
            target: run.inputMessageId,
          })
          .returning();
        const active = await client
          .select()
          .from(run)
          .where(and(eq(run.inputMessageId, row.id), eq(run.ownerId, context.session.user.id)))
          .limit(1);
        const item = queued[0] ?? active[0];

        if (!item) {
          throw new Error('Run insert failed');
        }

        await client
          .insert(event)
          .values({
            runId: item.id,
            threadId: item.threadId,
            ownerId: context.session.user.id,
            seq: 0,
            type: 'run.queued',
            data: { model: env.AGENT_MODEL },
          })
          .onConflictDoNothing({
            target: [event.runId, event.seq],
          });

        await client
          .update(thread)
          .set({ updatedAt: new Date() })
          .where(eq(thread.id, input.threadId));

        return {
          message: row,
          run: item,
          txid: await txid(client),
        };
      });

      start({
        ownerId: context.session.user.id,
        runId: res.run.id,
        threadId: input.threadId,
      });

      return res;
    }),
};
