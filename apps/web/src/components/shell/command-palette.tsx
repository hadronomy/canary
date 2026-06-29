import type { UseHotkeyDefinition } from '@tanstack/react-hotkeys';

import {
  ArrowRightIcon,
  CopyIcon,
  type Icon,
  MagnifyingGlassIcon,
  MonitorIcon,
  MoonIcon,
  PencilSimpleIcon,
  PlusIcon,
  SignOutIcon,
  SunIcon,
  TrayArrowDownIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import { useLiveQuery } from '@tanstack/react-db';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { useNavigate, useParams, useRouter, useRouterState } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';

import type {
  CommandContext,
  CommandItem,
  CommandPage,
  CommandSession,
  PageRef,
} from '~/components/command-palette/types';
import type { ShellNavRoute, ShellUser } from '~/components/shell/routes';

import {
  action as defineAction,
  filter,
  item as defineItem,
  remember,
} from '~/components/command-palette/model';
import {
  CommandCard,
  CommandPalette,
  CommandTrigger,
  type CommandPaletteApi,
  type CommandPaletteProps,
  type CommandTriggerProps,
} from '~/components/command-palette/palette';
import {
  useCommandRecents,
  useCommandScreen,
  writeRecents,
  writeScreen,
} from '~/components/command-palette/storage';
import { primaryNav } from '~/components/shell/routes';
import { useTheme } from '~/components/theme-provider';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { list, roster } from '~/utils/chat';

type ThreadRecord = {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
};

type ThemeChoice = 'dark' | 'light' | 'system';

type ShellCommandPaletteProps = Omit<
  CommandPaletteProps,
  'api' | 'initial' | 'onRemember' | 'onScreen' | 'resolve'
> & {
  user: ShellUser;
};

function ShellCommandPalette({
  onOpenChange,
  open: visible,
  user,
  ...props
}: ShellCommandPaletteProps) {
  const api = useRef<CommandPaletteApi | null>(null);
  const recents = useCommandRecents();
  const saved = useCommandScreen();
  const nav = useNavigate();
  const params = useParams({ strict: false });
  const router = useRouter();
  const theme = useTheme();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const mode = currentTheme(theme.theme);
  const owner = user.id;
  const active = typeof params.threadId === 'string' ? params.threadId : null;
  const col = useMemo(() => list(owner), [owner]);
  const rows = useLiveQuery(roster(owner)).data;
  const threads = useMemo(() => sorted(rows), [rows]);

  const hotkeys = useMemo<UseHotkeyDefinition[]>(
    () => [
      {
        hotkey: 'Mod+K',
        callback: (event) => {
          event.preventDefault();

          if (visible) {
            api.current?.actions();
            return;
          }

          onOpenChange(true);
        },
        options: {
          meta: {
            name: 'Command palette',
            description: 'Open Canary navigation, thread search, and contextual actions.',
          },
        },
      },
    ],
    [onOpenChange, visible],
  );

  useHotkeys(hotkeys, {
    conflictBehavior: 'replace',
    ignoreInputs: false,
    preventDefault: true,
    requireReset: true,
    stopPropagation: true,
  });

  if (!visible) return null;

  function resolve(state: CommandSession): CommandPage {
    const ref = state.stack[state.stack.length - 1] ?? state.stack[0];
    const query = ref.query;
    const navs = primaryNav.map((item) => route(item));
    const thread = threads.map((row) => threadItem(row));
    const create = createItem(ref);
    const pages = [
      pageItem({
        icon: MagnifyingGlassIcon,
        id: 'page:threads',
        page: { kind: 'threads', query: '' },
        subtitle: `${threads.length} searchable conversations`,
        title: 'Search threads',
        words: ['conversation', 'chat', 'history'],
      }),
      pageItem({
        icon: themeIcon(mode),
        id: 'page:theme',
        page: { kind: 'theme', query: '' },
        subtitle: `Current: ${themeName(mode)}`,
        title: 'Theme',
        words: ['appearance', 'light', 'dark', 'system'],
      }),
      pageItem({
        icon: UserCircleIcon,
        id: 'page:account',
        page: { kind: 'account', query: '' },
        subtitle: user.email ?? user.name ?? 'Local session',
        title: 'Account and sync',
        words: ['profile', 'user', 'sync', 'session'],
      }),
      signoutItem(),
    ];
    const all = new Map([...navs, create, ...thread, ...pages].map((item) => [item.id, item]));

    switch (ref.kind) {
      case 'account':
        return {
          ref,
          placeholder: 'Search account actions...',
          sections: [
            {
              id: 'account',
              items: filter(
                [
                  accountItem({
                    icon: UserCircleIcon,
                    id: 'account:profile',
                    run: (ctx) => ctx.actions('account:profile'),
                    subtitle: user.email ?? user.name ?? 'Local session',
                    title: 'Account details',
                    words: ['profile', 'user', 'session'],
                  }),
                  accountItem({
                    icon: themeIcon(mode),
                    id: 'account:theme',
                    run: (ctx) => ctx.page({ kind: 'theme', query: '' }),
                    subtitle: themeName(mode),
                    title: 'Theme settings',
                    words: ['appearance', 'theme'],
                  }),
                  signoutItem(),
                ],
                query,
              ),
              title: 'Account',
            },
          ],
          title: 'Account',
        };
      case 'create-thread':
        return {
          ref,
          placeholder: 'Name the new thread...',
          sections: [{ id: 'create', items: [create], title: 'Create' }],
          submit: create.primary,
          title: 'Create Thread',
        };
      case 'rename-thread':
        return renamePage(ref);
      case 'theme':
        return {
          ref,
          placeholder: 'Choose appearance...',
          sections: [
            {
              id: 'theme',
              items: filter(
                (['light', 'dark', 'system'] satisfies ThemeChoice[]).map((item) =>
                  themeItem(item),
                ),
                query,
              ),
              title: 'Appearance',
            },
          ],
          title: 'Theme',
        };
      case 'threads':
        return {
          ref,
          placeholder: 'Search conversations...',
          sections: [{ id: 'threads', items: filter(thread, query), title: 'Threads' }],
          title: 'Threads',
        };
      default:
        return {
          ref,
          placeholder: 'Search Canary...',
          sections: root(query, navs, thread, create, pages, all),
          title: 'Command Center',
        };
    }

    function route(item: ShellNavRoute): CommandItem {
      const Icon = item.icon;
      const to = String(item.to);
      const current = path === item.to || path.startsWith(`${item.to}/`);
      const primary = defineAction({
        icon: ArrowRightIcon,
        id: `route:${to}:open`,
        run: (ctx) => {
          ctx.close();
          return nav({ to: item.to }).catch((err: unknown) => {
            console.error('Command palette navigation failed.', err);
          });
        },
        shortcut: 'Enter',
        title: current ? 'Stay here' : 'Open',
      });

      return defineItem({
        detail: (
          <CommandCard label="Route" title={item.label} value={current ? 'Current location' : to} />
        ),
        icon: Icon,
        id: `route:${to}`,
        keywords: [item.area, item.label, to],
        primary,
        source: 'navigation',
        subtitle: current ? 'Current location' : 'Navigate',
        title: item.label,
      });
    }

    function pageItem(input: {
      icon: Icon;
      id: string;
      page: PageRef;
      subtitle: string;
      title: string;
      words: readonly string[];
    }) {
      const primary = defineAction({
        icon: ArrowRightIcon,
        id: `${input.id}:open`,
        run: (ctx) => ctx.page(input.page),
        shortcut: 'Enter',
        title: 'Open',
      });

      return defineItem({
        detail: <CommandCard label="Workspace" title={input.title} value={input.subtitle} />,
        icon: input.icon,
        id: input.id,
        keywords: input.words,
        primary,
        source: 'workspace',
        subtitle: input.subtitle,
        title: input.title,
      });
    }

    function accountItem(input: {
      icon: Icon;
      id: string;
      run: (ctx: CommandContext) => Promise<void> | void;
      subtitle: string;
      title: string;
      words: readonly string[];
    }) {
      const primary = defineAction({
        icon: input.icon,
        id: `${input.id}:run`,
        run: input.run,
        shortcut: 'Enter',
        title: input.title,
      });

      return defineItem({
        detail: <AccountDetail user={user} />,
        icon: input.icon,
        id: input.id,
        keywords: input.words,
        primary,
        source: 'workspace',
        subtitle: input.subtitle,
        title: input.title,
      });
    }

    function signoutItem() {
      const primary = defineAction({
        icon: SignOutIcon,
        id: 'workspace:signout:run',
        run: signout,
        shortcut: 'Enter',
        title: 'Sign out',
      });

      return defineItem({
        detail: (
          <CommandCard
            label="Workspace"
            title="Sign out"
            value={user.email ?? 'End the current session'}
          />
        ),
        icon: SignOutIcon,
        id: 'workspace:signout',
        keywords: ['logout', 'session'],
        primary,
        source: 'workspace',
        subtitle: user.email ?? 'End the current session',
        title: 'Sign out',
      });
    }

    function createItem(page: PageRef) {
      const submit = page.kind === 'create-thread';
      const text = submit ? page.query : query;
      const name = text.trim() || 'New thread';
      const primary = defineAction({
        icon: submit ? PlusIcon : ArrowRightIcon,
        id: submit ? 'thread:create:submit' : 'thread:create:open',
        run: (ctx) => {
          if (submit) return createThread(name);

          ctx.page({ kind: 'create-thread', query: text });
        },
        shortcut: submit ? '⌘ Enter' : 'Enter',
        title: submit ? 'Create thread' : 'Open create thread',
      });

      return defineItem({
        detail: <CommandCard label="Thread" title="Create thread" value={name} />,
        icon: PlusIcon,
        id: 'thread:create',
        keywords: ['new', 'create', 'chat', 'thread', name],
        primary,
        source: 'thread',
        subtitle: submit ? 'Press Command Enter to create' : 'Prepare a fresh conversation',
        title: submit ? `Create “${name}”` : 'Create new thread',
      });
    }

    function threadItem(row: ThreadRecord) {
      const name = row.title.trim() || 'Untitled thread';
      const short = row.id.slice(0, 8);
      const primary = defineAction({
        icon: ArrowRightIcon,
        id: `thread:${row.id}:open`,
        run: () => open(row.id),
        shortcut: 'Enter',
        title: 'Open thread',
      });

      return defineItem({
        actions: [
          defineAction({
            icon: PencilSimpleIcon,
            id: `thread:${row.id}:rename`,
            run: (ctx) => ctx.page({ kind: 'rename-thread', id: row.id, query: name }),
            title: 'Rename thread',
          }),
          defineAction({
            icon: CopyIcon,
            id: `thread:${row.id}:copy-title`,
            run: () => copy(name),
            title: 'Copy title',
          }),
          defineAction({
            icon: CopyIcon,
            id: `thread:${row.id}:copy-id`,
            run: () => copy(row.id),
            title: 'Copy id',
          }),
          defineAction({
            icon: TrayArrowDownIcon,
            id: `thread:${row.id}:archive`,
            run: () => archive(row.id),
            title: 'Archive thread',
            tone: 'danger',
          }),
        ],
        detail: <ThreadDetail row={row} />,
        icon: MagnifyingGlassIcon,
        id: `thread:${row.id}`,
        keywords: [row.id, row.title, row.createdAt, row.updatedAt, short],
        primary,
        source: 'thread',
        subtitle: `${stamp(row.updatedAt)} · ${short}`,
        title: name,
      });
    }

    function themeItem(value: ThemeChoice) {
      const Icon = themeIcon(value);
      const current = mode === value;
      const primary = defineAction({
        icon: Icon,
        id: `theme:${value}:apply`,
        run: (ctx) => {
          theme.setTheme(value);
          ctx.close();
        },
        shortcut: 'Enter',
        title: current ? 'Keep selected' : 'Apply theme',
      });

      return defineItem({
        detail: (
          <CommandCard
            label="Appearance"
            title={themeName(value)}
            value={current ? 'Currently selected' : 'Switch Canary appearance'}
          />
        ),
        icon: Icon,
        id: `theme:${value}`,
        keywords: ['appearance', 'theme', value],
        primary,
        source: 'workspace',
        subtitle: current ? 'Current theme' : 'Switch appearance',
        title: themeName(value),
      });
    }

    function renamePage(ref: Extract<PageRef, { kind: 'rename-thread' }>): CommandPage {
      const row = threads.find((item) => item.id === ref.id);
      const name = ref.query.trim() || row?.title.trim() || 'Untitled thread';
      const primary = defineAction({
        icon: PencilSimpleIcon,
        id: `thread:${ref.id}:rename-submit`,
        run: () => rename(ref.id, name),
        shortcut: '⌘ Enter',
        title: 'Rename thread',
      });

      return {
        ref,
        placeholder: 'Rename thread...',
        sections: [
          {
            id: 'rename',
            items: row
              ? [
                  defineItem({
                    detail: <ThreadDetail row={row} />,
                    icon: PencilSimpleIcon,
                    id: `thread:${ref.id}:rename-submit`,
                    keywords: [ref.id, name, row.title],
                    primary,
                    source: 'thread',
                    subtitle: 'Press Command Enter to rename',
                    title: `Rename to “${name}”`,
                  }),
                ]
              : [],
            title: 'Rename',
          },
        ],
        submit: primary,
        title: 'Rename Thread',
      };
    }

    function root(
      query: string,
      navs: readonly CommandItem[],
      threads: readonly CommandItem[],
      create: CommandItem,
      work: readonly CommandItem[],
      all: Map<string, CommandItem>,
    ) {
      const recent = recents
        .map((id) => all.get(id))
        .filter((item): item is CommandItem => item !== undefined)
        .filter((item) => filter([item], query).length > 0);
      const used = new Set(recent.map((item) => item.id));
      const routes = filter(navs, query).filter((item) => !used.has(item.id));
      const hits = filter(threads, query)
        .filter((item) => !used.has(item.id))
        .slice(0, query.trim() ? 10 : 7);
      const show = filter([create], query).length > 0 && !used.has(create.id);
      const workspace = filter(work, query).filter((item) => !used.has(item.id));

      return [
        { id: 'recent', items: recent, title: 'Recent' },
        { id: 'go', items: routes, title: 'Go to' },
        { id: 'threads', items: show ? [create, ...hits] : hits, title: 'Threads' },
        { id: 'workspace', items: workspace, title: 'Workspace' },
      ];
    }
  }

  function keep(id: string) {
    writeRecents(remember(recents, id));
  }

  function open(id: string) {
    onOpenChange(false);

    return nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    }).catch((err: unknown) => {
      console.error('Command palette thread navigation failed.', err);
    });
  }

  function createThread(value: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = value.trim() || 'New thread';
    const tx = col.insert({
      id,
      ownerId: owner,
      title: name,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    onOpenChange(false);

    return nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    })
      .then(() => tx.isPersisted.promise)
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error('Command palette thread create failed.', err);
      });
  }

  function rename(id: string, value: string) {
    const name = value.trim();

    if (!name) return;

    col.update(id, (draft) => {
      draft.title = name;
      draft.updatedAt = new Date().toISOString();
    });

    onOpenChange(false);
  }

  function archive(id: string) {
    const fallback = id === active ? after(threads, id) : null;

    col.update(id, (draft) => {
      draft.archivedAt = new Date().toISOString();
    });

    onOpenChange(false);

    if (id !== active) return;

    if (fallback) {
      return nav({
        to: '/threads/$threadId',
        params: { threadId: fallback.id },
        replace: true,
      }).catch((err: unknown) => {
        console.error('Command palette archive navigation failed.', err);
      });
    }

    return nav({
      to: '/threads',
      replace: true,
    }).catch((err: unknown) => {
      console.error('Command palette archive navigation failed.', err);
    });
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function signout(ctx: CommandContext) {
    ctx.close();
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  return (
    <CommandPalette
      api={api}
      initial={saved}
      onOpenChange={onOpenChange}
      onRemember={keep}
      onScreen={writeScreen}
      open={visible}
      resolve={resolve}
      {...props}
    />
  );
}

function AccountDetail(props: { user: ShellUser }) {
  return (
    <div className="grid gap-2">
      <CommandCard
        label="Account"
        title={props.user.name ?? 'Canary user'}
        value={props.user.email ?? 'Local session'}
      />
      <CommandCard label="Sync" title="Realtime sync" value="Electric local cache" />
    </div>
  );
}

function ThreadDetail(props: { row: ThreadRecord }) {
  return (
    <div className="grid gap-2">
      <CommandCard
        label="Thread"
        title={props.row.title.trim() || 'Untitled thread'}
        value={props.row.id}
      />
      <CommandCard label="Updated" title={stamp(props.row.updatedAt)} value={props.row.updatedAt} />
      <CommandCard label="Created" title={stamp(props.row.createdAt)} value={props.row.createdAt} />
    </div>
  );
}

function after(rows: readonly ThreadRecord[], id: string) {
  const at = rows.findIndex((row) => row.id === id);

  if (at < 0) return rows[0] ?? null;

  return rows[at + 1] ?? rows[at - 1] ?? null;
}

function sorted(rows: readonly ThreadRecord[]) {
  return rows
    .filter((row) => !row.archivedAt)
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

function stamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'unknown';

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const mins = Math.floor(diff / 60_000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;

  if (same(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function same(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function themeIcon(value: ThemeChoice): Icon {
  switch (value) {
    case 'dark':
      return MoonIcon;
    case 'light':
      return SunIcon;
    default:
      return MonitorIcon;
  }
}

function themeName(value: ThemeChoice) {
  switch (value) {
    case 'dark':
      return 'Dark theme';
    case 'light':
      return 'Light theme';
    default:
      return 'System theme';
  }
}

function currentTheme(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}

const ShellCommandTrigger = CommandTrigger;

export { ShellCommandPalette, ShellCommandTrigger };
export type { ShellCommandPaletteProps, CommandTriggerProps as ShellCommandTriggerProps };
