import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';

import { AppError, AppNotFound, type AppErrorProps } from '~/components/fallbacks/route';
import { routeTree } from '~/routeTree.gen';
import { createQueryClient, orpc } from '~/utils/orpc';

export function getRouter() {
  const queryClient = createQueryClient();

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadDelay: 0,
    defaultPreloadIntentProximity: 96,
    defaultPreloadStaleTime: 30_000,
    context: { orpc, queryClient },
    defaultErrorComponent: RouterError,
    defaultNotFoundComponent: RouterNotFound,
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

function RouterError(props: AppErrorProps) {
  return <AppError {...props} />;
}

function RouterNotFound() {
  return <AppNotFound />;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
