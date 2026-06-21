import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { getUser, userKey, userOptions } from '~/functions/get-user';

type MaybeUser = Awaited<ReturnType<typeof getUser>>;
type User = NonNullable<MaybeUser>;

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context, location }) => {
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

      return { user: cached satisfies User };
    }

    return context.queryClient.ensureQueryData(userOptions()).then((user) => {
      if (!user) {
        throw redirect({
          to: '/login',
          search: {
            redirect: location.href,
          },
        });
      }

      return { user };
    });
  },
  component: AuthComponent,
});

function AuthComponent() {
  return <Outlet />;
}
