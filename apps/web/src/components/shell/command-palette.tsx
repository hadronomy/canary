import { useLiveQuery } from '@tanstack/react-db';
import { useNavigate, useParams, useRouter, useRouterState } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';

import type { ShellUser } from '~/components/shell/routes';

import {
  CommandPalette,
  CommandTrigger,
  recordCommandUse,
  resetCommandUse,
  type CommandPaletteApi,
  type CommandPaletteProps,
  type CommandTriggerProps,
  type ItemId,
  type PageId,
  useCommandLearning,
  writeCommandPage,
} from '~/components/command-palette';
import { currentTheme, shellPalette, sorted } from '~/components/shell/command-modules';
import { useTheme } from '~/components/theme-provider';
import { list, roster } from '~/utils/chat';

type ShellCommandPaletteProps = Omit<
  CommandPaletteProps,
  'api' | 'initial' | 'onPage' | 'onReset' | 'onUse' | 'registry' | 'usage'
> & {
  user: ShellUser;
};

function ShellCommandPalette({ onOpenChange, open, user, ...props }: ShellCommandPaletteProps) {
  const api = useRef<CommandPaletteApi | null>(null);
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
  const deps = useMemo(
    () => ({
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
    [active, col, nav, onOpenChange, path, router, theme, threads, user],
  );
  const registry = useMemo(() => shellPalette.compile(deps), [deps]);
  const learning = useCommandLearning(owner, registry);
  const initial = registry.pages.has(learning.page) ? learning.page : registry.root;

  function record(id: ItemId, query: string) {
    recordCommandUse({ item: id, query, user: owner });
  }

  function reset(id: ItemId) {
    resetCommandUse({ item: id, user: owner });
  }

  function page(id: PageId) {
    writeCommandPage({ page: id, user: owner });
  }

  return (
    <CommandPalette
      api={api}
      initial={initial}
      onOpenChange={onOpenChange}
      onPage={page}
      onReset={reset}
      onUse={record}
      open={open}
      registry={registry}
      toggle={shellPalette.hotkeys?.toggle}
      usage={learning.usage}
      {...props}
    />
  );
}

const ShellCommandTrigger = CommandTrigger;

export { ShellCommandPalette, ShellCommandTrigger };
export type { ShellCommandPaletteProps, CommandTriggerProps as ShellCommandTriggerProps };
