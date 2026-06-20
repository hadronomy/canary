import { publicProcedure } from '../index';

export const healthRouter = {
  check: publicProcedure.handler(() => ({ ok: true })),
};
