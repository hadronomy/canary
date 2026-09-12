import { Effect } from 'effect';
import { z } from 'zod';

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
      return await Effect.runPromise(
        context.run.send({
          content: input.content,
          id: input.id,
          owner: context.owner,
          threadId: input.threadId,
        }),
      );
    }),
};
