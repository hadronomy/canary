import { desc, eq, isNull } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { z } from 'zod';

import { protectedProcedure } from '@canary/api';
import * as Run from '@canary/api/runner';
import { exec } from '@canary/api/runtime';
import { own } from '@canary/api/scope';
import { db, txid } from '@canary/db';
import { member, thread } from '@canary/db/schema/app';

export const threadRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    return await db
      .select()
      .from(thread)
      .where(own(thread, context.owner, isNull(thread.archivedAt)))
      .orderBy(desc(thread.updatedAt));
  }),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).handler(async ({ context, input }) => {
    const rows = await db
      .select()
      .from(thread)
      .where(own(thread, context.owner, eq(thread.id, input.id)))
      .limit(1);

    return rows[0] ?? null;
  }),

  create: protectedProcedure
    .input(
      z
        .object({
          id: z.uuid().optional(),
          title: z.string().trim().min(1).max(120).optional(),
        })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      return await db.transaction(async (client) => {
        const rows = await client
          .insert(thread)
          .values({
            id: input?.id,
            ownerId: context.owner,
            title: input?.title ?? 'New thread',
          })
          .returning();

        const row = rows[0];

        if (!row) {
          throw new Error('Thread insert failed');
        }

        await client.insert(member).values({
          threadId: row.id,
          userId: context.owner,
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
      return await exec(
        Schema.decodeUnknownEffect(Run.ThreadKey)({ ...input, owner: context.owner }).pipe(
          Effect.flatMap((input) => Run.Service.use((run) => run.archive(input))),
        ),
        context.signal,
      );
    }),
};
