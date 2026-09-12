import { Effect } from 'effect';

import { auth } from '@canary/auth';
import { Run } from '~/runner';

export async function createContext({ req }: { req: Request }) {
  const state = await Promise.all([
    auth.api.getSession({
      headers: req.headers,
    }),
    Effect.runPromise(Run.Service.pipe(Effect.provide(Run.layer))),
  ]);

  return { session: state[0], run: state[1] };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
