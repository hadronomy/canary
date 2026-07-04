import type { useNavigate, useRouter } from '@tanstack/react-router';

import type { ShellUser } from '~/components/shell/routes';
import type { useTheme } from '~/components/theme-provider';
import type { list } from '~/utils/chat';

type ThreadRecord = {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
};

type ThemeChoice = 'dark' | 'light' | 'system';

type ShellCommandDeps = {
  active: null | string;
  col: ReturnType<typeof list>;
  mode: ThemeChoice;
  nav: ReturnType<typeof useNavigate>;
  onOpenChange: (open: boolean) => void;
  path: string;
  router: ReturnType<typeof useRouter>;
  theme: ReturnType<typeof useTheme>;
  threads: readonly ThreadRecord[];
  user: ShellUser;
};

export type { ShellCommandDeps, ThemeChoice, ThreadRecord };
