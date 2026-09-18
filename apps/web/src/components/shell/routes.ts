import type { LinkProps, StaticDataRouteOption } from '@tanstack/react-router';

import { ChatsIcon, HouseIcon, NotePencilIcon, type Icon } from '@phosphor-icons/react';

type ShellUser = {
  email?: null | string;
  id: string;
  image?: null | string;
  name?: null | string;
};

type ShellNav = {
  exact?: boolean;
  order: number;
};

type ShellRoute = {
  icon: Icon;
  id: string;
  label: string;
  nav?: ShellNav;
  to: NonNullable<LinkProps['to']>;
};

type ShellNavRoute = ShellRoute & {
  nav: ShellNav;
};

function defineShellRoutes<const Routes extends Record<string, ShellRoute>>(routes: Routes) {
  return routes;
}

function isNavRoute(route: ShellRoute): route is ShellNavRoute {
  return route.nav !== undefined;
}

const shellRoutes = defineShellRoutes({
  // Starting a thread is the most common thing anyone does here, so it sits at
  // the top of the nav as a destination rather than hiding behind a button.
  thread: {
    icon: NotePencilIcon,
    id: 'thread',
    label: 'New thread',
    nav: {
      exact: true,
      order: 10,
    },
    to: '/threads',
  },

  home: {
    icon: HouseIcon,
    id: 'home',
    label: 'Home',
    nav: {
      exact: true,
      order: 20,
    },
    to: '/',
  },

  // An open conversation is a shell route without a nav entry: the sidebar
  // already lists every thread, so a second way in would only be noise.
  conversation: {
    icon: ChatsIcon,
    id: 'conversation',
    label: 'Thread',
    to: '/threads/$threadId',
  },
});

const shellRouteList: readonly ShellRoute[] = Object.values(shellRoutes);

const primaryNav = shellRouteList
  .filter(isNavRoute)
  .sort((left, right) => left.nav.order - right.nav.order);

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    shell?: ShellRoute;
  }
}

function shellFromMatches(matches: readonly { staticData: StaticDataRouteOption }[]) {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const shell = matches[index]?.staticData.shell;

    if (shell) {
      return shell;
    }
  }

  return null;
}

export { primaryNav, shellFromMatches, shellRoutes };
export type { ShellNavRoute, ShellRoute, ShellUser };
