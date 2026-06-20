import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { getUser } from '~/functions/get-user';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ location }) => {
    const user = await getUser();

    if (!user) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      });
    }

    return { user };
  },
  component: AuthComponent,
});

function AuthComponent() {
  return <Outlet />;
}
