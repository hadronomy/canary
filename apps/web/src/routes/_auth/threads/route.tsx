import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';

import { AppError, AppNotFound, type AppErrorProps } from '~/components/fallbacks/route';
import { roster, setup } from '~/utils/chat';

export const Route = createFileRoute('/_auth/threads')({
  ssr: false,
  beforeLoad: async () => {
    await setup();
  },
  loader: async ({ context }) => {
    await roster(context.user.id).preload();
    return null;
  },
  errorComponent: ThreadsError,
  notFoundComponent: ThreadsNotFound,
  component: ThreadsComponent,
});

function ThreadsComponent() {
  return <Outlet />;
}

function ThreadsError(props: AppErrorProps) {
  const path = useRouterState({
    select: (state) => state.location.href,
  });

  return <AppError {...props} path={path} scope="panel" />;
}

function ThreadsNotFound() {
  const path = useRouterState({
    select: (state) => state.location.href,
  });

  return <AppNotFound path={path} scope="panel" />;
}
