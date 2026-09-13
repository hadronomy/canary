import { Effect, Schema } from 'effect';
import { z } from 'zod';

import { protectedProcedure } from '@canary/api';
import * as Run from '@canary/api/runner';
import { exec } from '@canary/api/runtime';

export const runRouter = {
  cancel: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      return await exec(
        Schema.decodeUnknownEffect(Run.Key)({ ...input, owner: context.owner }).pipe(
          Effect.flatMap((input) => Run.Service.use((run) => run.cancel(input))),
        ),
        context.signal,
      );
    }),
};
