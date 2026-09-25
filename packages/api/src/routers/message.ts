import { Effect, Schema } from 'effect';
import { z } from 'zod';

import { protectedProcedure } from '@canary/api';
import { ids as models } from '@canary/api/models';
import * as Run from '@canary/api/runner';
import { exec } from '@canary/api/runtime';

export const messageRouter = {
  send: protectedProcedure
    .input(
      z.object({
        id: z.uuid().optional(),
        threadId: z.uuid(),
        content: z.string().trim().min(1).max(64_000),
        model: z.enum(models).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await exec(
        Schema.decodeUnknownEffect(Run.Send)({
          ...input,
          owner: context.owner,
        }).pipe(Effect.flatMap((input) => Run.Service.use((run) => run.send(input)))),
        context.signal,
      );
    }),
};
