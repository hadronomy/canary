import { auth } from '@canary/auth';

import { recover } from './runner';

export async function createContext({ req }: { req: Request }) {
  recover();

  const session = await auth.api.getSession({
    headers: req.headers,
  });

  return { session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
