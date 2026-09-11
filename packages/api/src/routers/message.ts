import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db, txid } from '@canary/db';
import { event, message, run, thread } from '@canary/db/schema/app';
import { env } from '@canary/env/server';
import { own } from '~/scope';

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
            own(thread, context.owner, eq(thread.id, input.threadId), isNull(thread.archivedAt)),
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
            ownerId: context.owner,
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
                own(
                  message,
                  context.owner,
                  eq(message.id, input.id),
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
            ownerId: context.owner,
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
          .where(own(run, context.owner, eq(run.inputMessageId, row.id)))
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
            ownerId: context.owner,
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
          .where(own(thread, context.owner, eq(thread.id, input.threadId)));

        return {
          message: row,
          run: item,
          txid: await txid(client),
        };
      });

      start({
        ownerId: context.owner,
        runId: res.run.id,
        threadId: input.threadId,
      });

      return res;
    }),
};
