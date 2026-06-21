import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { auth } from '@canary/auth';

export const userKey = ['auth', 'user'] as const;

export const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({
    headers: getRequest().headers,
  });

  return session?.user ?? null;
});

export function userOptions() {
  return queryOptions({
    queryKey: userKey,
    queryFn: () => getUser(),
    staleTime: 60_000,
  });
}
