import type { Icon } from '@phosphor-icons/react';

import { ChatsIcon, HouseIcon } from '~/components/icons';

type ShellUser = {
  email?: null | string;
  id: string;
  image?: null | string;
  name?: null | string;
};

type Nav = {
  icon: Icon;
  label: string;
  to: '/' | '/threads';
};

const navs = [
  { icon: HouseIcon, label: 'Home', to: '/' },
  { icon: ChatsIcon, label: 'Chat', to: '/threads' },
] satisfies Nav[];

const ease = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const;

export { ease, navs };
export type { Nav, ShellUser };
