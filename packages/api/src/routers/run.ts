import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { reply } from '@canary/agents';
import { db, txid } from '@canary/db';
import { event, message, run, thread } from '@canary/db/schema/app';
import { env } from '@canary/env/server';

import { protectedProcedure } from '../index';

const shape = z.object({ threadId: z.uuid() });

export const runRouter = {
  start: protectedProcedure.input(shape).handler(async ({ context, input }) => {
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

      const runs = await client
        .insert(run)
        .values({
          threadId: input.threadId,
          ownerId: context.session.user.id,
          status: 'running',
          model: env.AGENT_MODEL,
          startedAt: new Date(),
        })
        .returning();

      const row = runs[0];

      if (!row) {
        throw new Error('Run insert failed');
      }

      await client.insert(event).values({
        runId: row.id,
        threadId: input.threadId,
        ownerId: context.session.user.id,
        seq: 0,
        type: 'run.started',
        data: { model: env.AGENT_MODEL },
      });

      return {
        run: row,
        txid: await txid(client),
      };
    });

    complete({
      ownerId: context.session.user.id,
      runId: res.run.id,
      threadId: input.threadId,
    }).catch((err: unknown) => {
      return fail({
        err,
        ownerId: context.session.user.id,
        runId: res.run.id,
        threadId: input.threadId,
      });
    });

    return res;
  }),

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
          await client.insert(event).values({
            runId: row.id,
            threadId: row.threadId,
            ownerId: context.session.user.id,
            seq: 99_999,
            type: 'run.cancelled',
          });
        }

        return {
          run: row ?? null,
          txid: await txid(client),
        };
      });
    }),
};

async function complete(opts: { ownerId: string; runId: string; threadId: string }) {
  const rows = await db
    .select({
      role: message.role,
      content: message.content,
    })
    .from(message)
    .where(and(eq(message.threadId, opts.threadId), eq(message.ownerId, opts.ownerId)))
    .orderBy(desc(message.createdAt))
    .limit(24);

  const content = await reply({
    ...opts,
    messages: rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    })),
  });

  await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(run.id, opts.runId),
          eq(run.ownerId, opts.ownerId),
          inArray(run.status, ['queued', 'running']),
        ),
      )
      .returning({ id: run.id });

    if (!rows[0]) {
      return;
    }

    await client.insert(event).values({
      runId: opts.runId,
      threadId: opts.threadId,
      ownerId: opts.ownerId,
      seq: 1,
      type: 'message.delta',
      data: { content },
    });

    await client.insert(message).values({
      threadId: opts.threadId,
      ownerId: opts.ownerId,
      runId: opts.runId,
      role: 'assistant',
      content,
    });

    await client
      .update(thread)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(thread.id, opts.threadId),
          eq(thread.ownerId, opts.ownerId),
          isNull(thread.archivedAt),
        ),
      );

    await client.insert(event).values({
      runId: opts.runId,
      threadId: opts.threadId,
      ownerId: opts.ownerId,
      seq: 2,
      type: 'run.completed',
    });
  });
}

async function fail(opts: { err: unknown; ownerId: string; runId: string; threadId: string }) {
  const err = opts.err instanceof Error ? opts.err.message : String(opts.err);

  await db.transaction(async (client) => {
    const rows = await client
      .update(run)
      .set({
        status: 'failed',
        error: err,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(run.id, opts.runId),
          eq(run.ownerId, opts.ownerId),
          inArray(run.status, ['queued', 'running']),
        ),
      )
      .returning({ id: run.id });

    if (!rows[0]) {
      return;
    }

    await client.insert(event).values({
      runId: opts.runId,
      threadId: opts.threadId,
      ownerId: opts.ownerId,
      seq: 99_998,
      type: 'run.failed',
      data: { error: err },
    });
  });
}
