import type { LinkProps, StaticDataRouteOption } from '@tanstack/react-router';

import { ChatsIcon, HouseIcon, type Icon } from '@phosphor-icons/react';

type ShellUser = {
  email?: null | string;
  id: string;
  image?: null | string;
  name?: null | string;
};

type ShellArea = 'chat' | 'home';

type ShellAside = 'threads';

type ShellNav = {
  exact?: boolean;
  order: number;
};

type ShellRoute = {
  area: ShellArea;
  aside?: ShellAside;
  icon: Icon;
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
  home: {
    area: 'home',
    icon: HouseIcon,
    label: 'Home',
    nav: {
      exact: true,
      order: 10,
    },
    to: '/',
  },

  chat: {
    area: 'chat',
    aside: 'threads',
    icon: ChatsIcon,
    label: 'Chat',
    nav: {
      order: 20,
    },
    to: '/threads',
  },
});

const shellRouteList: readonly ShellRoute[] = Object.values(shellRoutes);

const primaryNav = shellRouteList
  .filter(isNavRoute)
  .sort((left, right) => left.nav.order - right.nav.order);

const ease = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const;

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

export { ease, primaryNav, shellFromMatches, shellRoutes };
export type { ShellArea, ShellAside, ShellNavRoute, ShellRoute, ShellUser };
