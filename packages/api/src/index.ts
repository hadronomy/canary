import { ORPCError, os } from '@orpc/server';

import type { Context } from '@canary/api/context';

const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  const id = context.session?.user?.id;

  if (!id) {
    throw new ORPCError('UNAUTHORIZED');
  }

  return next({
    context: {
      session: context.session,
      owner: id,
      signal: context.signal,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
