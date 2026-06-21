import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createRouterClient, type RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { toast } from 'sonner';

import { createContext } from '@canary/api/context';
import { appRouter } from '@canary/api/routers/index';

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: 'retry',
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

const getClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(appRouter, {
      context: async () => createContext({ req: getRequest() }),
    }),
  )
  .client((): RouterClient<typeof appRouter> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
      fetch(url, opts) {
        return fetch(url, {
          ...opts,
          credentials: 'include',
        });
      },
    });

    return createORPCClient(link);
  });

export const client: RouterClient<typeof appRouter> = getClient();
export const orpc = createTanstackQueryUtils(client);
