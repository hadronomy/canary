import { Outlet, createFileRoute } from '@tanstack/react-router';

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
  component: ThreadsComponent,
});

function ThreadsComponent() {
  return <Outlet />;
}
