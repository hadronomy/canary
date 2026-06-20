import { auth } from '@canary/auth';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

export const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({
    headers: getRequest().headers,
  });

  return session?.user ?? null;
});
