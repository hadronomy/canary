import { Effect, Schema } from 'effect';
import { z } from 'zod';

import { protectedProcedure } from '@canary/api';
import * as Run from '@canary/api/runner';
import { exec } from '@canary/api/runtime';

export const threadRouter = {
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
      return await exec(
        Schema.decodeUnknownEffect(Run.Create)({ ...input, owner: context.owner }).pipe(
          Effect.flatMap((input) => Run.Service.use((run) => run.create(input))),
        ),
        context.signal,
      );
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
