import { useLiveQuery } from '@tanstack/react-db';
import { useNavigate, useParams, useRouter, useRouterState } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';

import type { ShellUser } from '~/components/shell/routes';

import {
  CommandPalette,
  CommandTrigger,
  compileCommandPalette,
  type CommandPaletteApi,
  type CommandPaletteProps,
  type CommandTriggerProps,
} from '~/components/command-palette';
import {
  useCommandPage,
  useCommandRecents,
  writePage,
  writeRecents,
} from '~/components/command-palette';
import { remember } from '~/components/command-palette/model';
import {
  currentTheme,
  shellCommandTree,
  shellPalette,
  sorted,
} from '~/components/shell/command-palette-modules';
import { useTheme } from '~/components/theme-provider';
import { list, roster } from '~/utils/chat';

type ShellCommandPaletteProps = Omit<
  CommandPaletteProps,
  'api' | 'initial' | 'onPage' | 'onRemember' | 'recents' | 'registry'
> & {
  user: ShellUser;
};

function ShellCommandPalette({ onOpenChange, open, user, ...props }: ShellCommandPaletteProps) {
  const api = useRef<CommandPaletteApi | null>(null);
  const recents = useCommandRecents();
  const page = useCommandPage();
  const nav = useNavigate();
  const params = useParams({ strict: false });
  const router = useRouter();
  const theme = useTheme();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const owner = user.id;
  const active = typeof params.threadId === 'string' ? params.threadId : null;
  const col = useMemo(() => list(owner), [owner]);
  const rows = useLiveQuery(roster(owner)).data;
  const threads = useMemo(() => sorted(rows), [rows]);
  const registry = compileCommandPalette(
    shellCommandTree({
      active,
      col,
      mode: currentTheme(theme.theme),
      nav,
      onOpenChange,
      path,
      router,
      theme,
      threads,
      user,
    }),
    shellPalette.root,
  );

  function keep(id: string) {
    writeRecents(remember(recents, id));
  }

  return (
    <CommandPalette
      api={api}
      initial={page}
      onOpenChange={onOpenChange}
      onPage={writePage}
      onRemember={keep}
      open={open}
      recents={recents}
      registry={registry}
      toggle={shellPalette.hotkeys?.toggle}
      {...props}
    />
  );
}

const ShellCommandTrigger = CommandTrigger;

export { ShellCommandPalette, ShellCommandTrigger };
export type { ShellCommandPaletteProps, CommandTriggerProps as ShellCommandTriggerProps };
