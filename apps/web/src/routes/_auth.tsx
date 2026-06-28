import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { ShellFrame } from '~/components/shell/frame';
import { getUser, userKey, userOptions } from '~/functions/get-user';
import { setup } from '~/utils/chat';

type MaybeUser = Awaited<ReturnType<typeof getUser>>;
type User = NonNullable<MaybeUser>;

export const Route = createFileRoute('/_auth')({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const cached = context.queryClient.getQueryData<MaybeUser>(userKey);

    if (cached !== undefined) {
      if (!cached) {
        throw redirect({
          to: '/login',
          search: {
            redirect: location.href,
          },
        });
      }

      await setup();
      return { user: cached satisfies User };
    }

    const user = await context.queryClient.ensureQueryData(userOptions());

    if (!user) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      });
    }

    await setup();
    return { user };
  },
  component: AuthComponent,
});

function AuthComponent() {
  const ctx = Route.useRouteContext();

  return (
    <ShellFrame user={ctx.user}>
      <Outlet />
    </ShellFrame>
  );
}
