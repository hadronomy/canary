import { Effect } from 'effect';
import { z } from 'zod';

import { protectedProcedure } from '../index';

export const runRouter = {
  cancel: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      return await Effect.runPromise(context.run.cancel({ id: input.id, owner: context.owner }));
    }),
};
