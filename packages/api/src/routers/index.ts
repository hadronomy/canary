import type { RouterClient } from '@orpc/server';

import { healthRouter } from './health';
import { messageRouter } from './message';
import { runRouter } from './run';
import { threadRouter } from './thread';

export const appRouter = {
  health: healthRouter,
  thread: threadRouter,
  message: messageRouter,
  run: runRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
