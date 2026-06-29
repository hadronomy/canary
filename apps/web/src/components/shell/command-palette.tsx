import type { UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react';

import {
  ArrowBendUpLeftIcon,
  ArrowRightIcon,
  CommandIcon,
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
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ShellNavRoute, ShellUser } from '~/components/shell/routes';

import { primaryNav } from '~/components/shell/routes';
import { useTheme } from '~/components/theme-provider';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '~/components/ui/command';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { Elevated } from '~/lib/elevated';
import { surfaceClasses, surfaceState } from '~/lib/surface-classes';
import { useSurface } from '~/lib/surface-context';
import { cn } from '~/lib/utils';
import { list, roster } from '~/utils/chat';

const RECENTS = 'canary.commandPalette.recents.v1';
const SCREEN = 'canary.commandPalette.screen.v1';
const MAX_RECENTS = 20;
const SCREENS = ['account', 'create', 'root', 'theme', 'threads'] as const;

type ThreadRecord = {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
};

type ThemeChoice = 'dark' | 'light' | 'system';

type PaletteSource = 'navigation' | 'recent' | 'thread' | 'workspace';

type PalettePageId = 'account' | 'create' | 'root' | 'theme' | 'threads' | `rename:${string}`;

type PaletteScreen = (typeof SCREENS)[number];

type PaletteContext = {
  actions: (open: boolean) => void;
  close: () => void;
  page: (page: PalettePageId, query?: string) => void;
};

type PaletteAction = {
  icon: Icon;
  id: string;
  run: (ctx: PaletteContext) => Promise<void> | void;
  shortcut?: string;
  title: string;
  tone?: 'danger' | 'default';
};

type PaletteItem = {
  actions: PaletteAction[];
  detail?: ReactNode;
  icon: Icon;
  id: string;
  keywords: string[];
  select?: (ctx: PaletteContext) => Promise<void> | void;
  source: PaletteSource;
  subtitle?: string;
  title: string;
};

type PaletteSection = {
  id: string;
  items: PaletteItem[];
  title: string;
};

type PalettePage = {
  id: PalettePageId;
  placeholder: string;
  sections: (ctx: PaletteContext) => PaletteSection[];
  title: string;
};

type ShellCommandPaletteProps = Omit<
  ComponentPropsWithoutRef<typeof CommandDialog>,
  'children' | 'description' | 'onOpenChange' | 'open' | 'title'
> & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: ShellUser;
};

function ShellCommandPalette({
  className,
  onOpenChange,
  open,
  user,
  ...props
}: ShellCommandPaletteProps) {
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

  const [pages, setPages] = useState<PalettePageId[]>(['root']);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [actions, setActions] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  const threads = useMemo(() => sorted(rows), [rows]);
  const page = pages[pages.length - 1] ?? 'root';
  const term = norm(query);
  const title = query.trim();
  const ctx = context();

  const navs = primaryNav.map((item) => routeItem(item));
  const thread = threads.map((row) => threadItem(row));
  const create = createItem(page === 'create');
  const threadPage = pageItem({
    icon: MagnifyingGlassIcon,
    id: 'page:threads',
    page: 'threads',
    subtitle: `${threads.length} searchable conversations`,
    title: 'Search threads',
    words: ['conversation', 'chat', 'history'],
  });
  const themePage = pageItem({
    icon: themeIcon(mode),
    id: 'page:theme',
    page: 'theme',
    subtitle: `Current: ${themeName(mode)}`,
    title: 'Theme',
    words: ['appearance', 'light', 'dark', 'system'],
  });
  const accountPage = pageItem({
    icon: UserCircleIcon,
    id: 'page:account',
    page: 'account',
    subtitle: user.email ?? user.name ?? 'Local session',
    title: 'Account and sync',
    words: ['profile', 'user', 'sync', 'session'],
  });
  const signout = actionItem({
    icon: SignOutIcon,
    id: 'workspace:signout',
    run: signoutUser,
    subtitle: user.email ?? 'End the current session',
    title: 'Sign out',
    words: ['logout', 'session'],
  });
  const work = [threadPage, themePage, accountPage, signout];
  const all = new Map([...navs, create, ...thread, ...work].map((item) => [item.id, item]));
  const sections = view()
    .sections(ctx)
    .filter((item) => item.items.length);
  const flat = sections.flatMap((item) => item.items);
  const selected = flat.find((item) => item.id === value) ?? flat[0] ?? null;
  const empty = flat.length === 0;

  const hotkeys = useMemo<UseHotkeyDefinition[]>(
    () => [
      {
        hotkey: 'Mod+K',
        callback: (event) => {
          event.preventDefault();

          if (open) {
            if (selected) {
              setActions(true);
            }

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
    [onOpenChange, open, selected],
  );

  useHotkeys(hotkeys, {
    conflictBehavior: 'replace',
    ignoreInputs: false,
    preventDefault: true,
    requireReset: true,
    stopPropagation: true,
  });

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  useEffect(() => {
    if (open) {
      setPages(stack(readScreen()));
    }

    setQuery('');
    setActions(false);
    setValue('');
  }, [open]);

  useEffect(() => {
    if (open) {
      writeScreen(page);
    }
  }, [open, page]);

  useEffect(() => {
    setValue((current) =>
      flat.some((item) => item.id === current) ? current : (flat[0]?.id ?? ''),
    );
  }, [flat]);

  useEffect(() => {
    if (!open || actions) {
      return;
    }

    const id = requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(id);
  }, [actions, open, page]);

  function context(): PaletteContext {
    return {
      actions: setActions,
      close,
      page: push,
    };
  }

  function close() {
    onOpenChange(false);
  }

  function push(next: PalettePageId, text = '') {
    setPages((current) => (next === 'root' ? ['root'] : [...current, next]));
    setQuery(text);
    setActions(false);
  }

  function back() {
    setPages((current) => (current.length > 1 ? current.slice(0, -1) : current));
    setQuery('');
    setActions(false);
  }

  function remember(id: string) {
    setRecents((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENTS);
      writeRecents(next);
      return next;
    });
  }

  function choose(item: PaletteItem) {
    const run = item.select ?? item.actions[0]?.run;

    if (!run) {
      return;
    }

    Promise.resolve(run(ctx)).then(() => remember(item.id));
  }

  function act(action: PaletteAction) {
    setActions(false);
    Promise.resolve(action.run(ctx)).then(() => remember(action.id));
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (actions) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setActions(false);
      }

      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      if (page === 'create') {
        event.preventDefault();
        createThread(title);
        return;
      }

      const id = renameId(page);

      if (id) {
        event.preventDefault();
        renameThread(id, title);
        return;
      }
    }

    if (event.key === 'ArrowRight' && selected?.actions.length) {
      event.preventDefault();
      setActions(true);
      return;
    }

    if (event.key === 'Backspace' && page !== 'root' && query.length === 0) {
      event.preventDefault();
      back();
      return;
    }

    if (event.key !== 'Escape') {
      return;
    }

    if (page !== 'root') {
      event.preventDefault();
      event.stopPropagation();
      back();
    }
  }

  function mouse(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) {
      return;
    }

    event.preventDefault();

    if (!actions) {
      input.current?.focus({ preventScroll: true });
    }
  }

  function routeItem(item: ShellNavRoute): PaletteItem {
    const Icon = item.icon;
    const to = String(item.to);
    const current = path === item.to || path.startsWith(`${item.to}/`);

    return {
      actions: [
        {
          icon: ArrowRightIcon,
          id: `route:${to}:open`,
          run: () => {
            close();
            return nav({ to: item.to }).catch((err: unknown) => {
              console.error('Command palette navigation failed.', err);
            });
          },
          shortcut: 'Enter',
          title: current ? 'Stay here' : 'Open',
        },
      ],
      detail: (
        <PaletteCard label="Route" title={item.label} value={current ? 'Current location' : to} />
      ),
      icon: Icon,
      id: `route:${to}`,
      keywords: [item.area, item.label, to],
      select: () => {
        close();

        return nav({ to: item.to }).catch((err: unknown) => {
          console.error('Command palette navigation failed.', err);
        });
      },
      source: 'navigation',
      subtitle: current ? 'Current location' : 'Navigate',
      title: item.label,
    };
  }

  function pageItem(input: {
    icon: Icon;
    id: string;
    page: PalettePageId;
    subtitle: string;
    title: string;
    words: string[];
  }): PaletteItem {
    return {
      actions: [
        {
          icon: ArrowRightIcon,
          id: `${input.id}:open`,
          run: (item) => item.page(input.page),
          shortcut: 'Enter',
          title: 'Open',
        },
      ],
      detail: <PaletteCard label="Workspace" title={input.title} value={input.subtitle} />,
      icon: input.icon,
      id: input.id,
      keywords: input.words,
      select: (item) => item.page(input.page),
      source: 'workspace',
      subtitle: input.subtitle,
      title: input.title,
    };
  }

  function actionItem(input: {
    icon: Icon;
    id: string;
    run: (ctx: PaletteContext) => Promise<void> | void;
    subtitle: string;
    title: string;
    words: string[];
  }): PaletteItem {
    return {
      actions: [
        {
          icon: input.icon,
          id: `${input.id}:run`,
          run: input.run,
          shortcut: 'Enter',
          title: input.title,
        },
      ],
      detail: <PaletteCard label="Workspace" title={input.title} value={input.subtitle} />,
      icon: input.icon,
      id: input.id,
      keywords: input.words,
      select: input.run,
      source: 'workspace',
      subtitle: input.subtitle,
      title: input.title,
    };
  }

  function createItem(submit: boolean): PaletteItem {
    const name = title || 'New thread';

    return {
      actions: [
        {
          icon: submit ? PlusIcon : ArrowRightIcon,
          id: submit ? 'thread:create:submit' : 'thread:create:open',
          run: (item) => {
            if (submit) {
              return createThread(name);
            }

            item.page('create', title);
          },
          shortcut: submit ? '⌘ Enter' : 'Enter',
          title: submit ? 'Create thread' : 'Open create thread',
        },
      ],
      detail: <PaletteCard label="Thread" title="Create thread" value={name} />,
      icon: PlusIcon,
      id: 'thread:create',
      keywords: ['new', 'create', 'chat', 'thread', name],
      select: (item) => {
        if (submit) {
          return createThread(name);
        }

        item.page('create', title);
      },
      source: 'thread',
      subtitle: submit ? 'Press Command Enter to create' : 'Prepare a fresh conversation',
      title: submit ? `Create “${name}”` : 'Create new thread',
    };
  }

  function threadItem(row: ThreadRecord): PaletteItem {
    const name = row.title.trim() || 'Untitled thread';
    const short = row.id.slice(0, 8);

    return {
      actions: [
        {
          icon: ArrowRightIcon,
          id: `thread:${row.id}:open`,
          run: () => openThread(row.id),
          shortcut: 'Enter',
          title: 'Open thread',
        },
        {
          icon: PencilSimpleIcon,
          id: `thread:${row.id}:rename`,
          run: (item) => item.page(`rename:${row.id}`, name),
          title: 'Rename thread',
        },
        {
          icon: CopyIcon,
          id: `thread:${row.id}:copy-title`,
          run: () => copy(name),
          title: 'Copy title',
        },
        {
          icon: CopyIcon,
          id: `thread:${row.id}:copy-id`,
          run: () => copy(row.id),
          title: 'Copy id',
        },
        {
          icon: TrayArrowDownIcon,
          id: `thread:${row.id}:archive`,
          run: () => archiveThread(row.id),
          title: 'Archive thread',
          tone: 'danger',
        },
      ],
      detail: <ThreadDetail row={row} />,
      icon: MagnifyingGlassIcon,
      id: `thread:${row.id}`,
      keywords: [row.id, row.title, row.createdAt, row.updatedAt, short],
      select: () => openThread(row.id),
      source: 'thread',
      subtitle: `${stamp(row.updatedAt)} · ${short}`,
      title: name,
    };
  }

  function themeItem(value: ThemeChoice): PaletteItem {
    const Icon = themeIcon(value);
    const current = mode === value;

    return {
      actions: [
        {
          icon: Icon,
          id: `theme:${value}:apply`,
          run: () => {
            theme.setTheme(value);
            close();
          },
          shortcut: 'Enter',
          title: current ? 'Keep selected' : 'Apply theme',
        },
      ],
      detail: (
        <PaletteCard
          label="Appearance"
          title={themeName(value)}
          value={current ? 'Currently selected' : 'Switch Canary appearance'}
        />
      ),
      icon: Icon,
      id: `theme:${value}`,
      keywords: ['appearance', 'theme', value],
      select: () => {
        theme.setTheme(value);
        close();
      },
      source: 'workspace',
      subtitle: current ? 'Current theme' : 'Switch appearance',
      title: themeName(value),
    };
  }

  function accountItem(input: {
    icon: Icon;
    id: string;
    run: (ctx: PaletteContext) => Promise<void> | void;
    subtitle: string;
    title: string;
    words: string[];
  }): PaletteItem {
    return {
      actions: [
        {
          icon: input.icon,
          id: `${input.id}:run`,
          run: input.run,
          shortcut: 'Enter',
          title: input.title,
        },
      ],
      detail: <AccountDetail user={user} />,
      icon: input.icon,
      id: input.id,
      keywords: input.words,
      select: input.run,
      source: 'workspace',
      subtitle: input.subtitle,
      title: input.title,
    };
  }

  function view(): PalettePage {
    if (page === 'threads') {
      return {
        id: page,
        placeholder: 'Search conversations...',
        sections: () => [
          {
            id: 'threads',
            items: filter(thread, query),
            title: 'Threads',
          },
        ],
        title: 'Threads',
      };
    }

    if (page === 'theme') {
      return {
        id: page,
        placeholder: 'Choose appearance...',
        sections: () => [
          {
            id: 'theme',
            items: filter(
              (['light', 'dark', 'system'] satisfies ThemeChoice[]).map((item) => themeItem(item)),
              query,
            ),
            title: 'Appearance',
          },
        ],
        title: 'Theme',
      };
    }

    if (page === 'account') {
      return {
        id: page,
        placeholder: 'Search account actions...',
        sections: () => [
          {
            id: 'account',
            items: filter(
              [
                accountItem({
                  icon: UserCircleIcon,
                  id: 'account:profile',
                  run: (item) => item.actions(true),
                  subtitle: user.email ?? user.name ?? 'Local session',
                  title: 'Account details',
                  words: ['profile', 'user', 'session'],
                }),
                accountItem({
                  icon: themeIcon(mode),
                  id: 'account:theme',
                  run: (item) => item.page('theme'),
                  subtitle: themeName(mode),
                  title: 'Theme settings',
                  words: ['appearance', 'theme'],
                }),
                signout,
              ],
              query,
            ),
            title: 'Account',
          },
        ],
        title: 'Account',
      };
    }

    if (page === 'create') {
      return {
        id: page,
        placeholder: 'Name the new thread...',
        sections: () => [
          {
            id: 'create',
            items: [create],
            title: 'Create',
          },
        ],
        title: 'Create Thread',
      };
    }

    const id = renameId(page);

    if (id) {
      const row = threads.find((item) => item.id === id);
      const name = query.trim() || row?.title.trim() || 'Untitled thread';

      return {
        id: page,
        placeholder: 'Rename thread...',
        sections: () => [
          {
            id: 'rename',
            items: row
              ? [
                  {
                    actions: [
                      {
                        icon: PencilSimpleIcon,
                        id: `thread:${id}:rename-submit`,
                        run: () => renameThread(id, name),
                        shortcut: '⌘ Enter',
                        title: 'Rename thread',
                      },
                    ],
                    detail: <ThreadDetail row={row} />,
                    icon: PencilSimpleIcon,
                    id: `thread:${id}:rename-submit`,
                    keywords: [id, name, row.title],
                    select: () => renameThread(id, name),
                    source: 'thread',
                    subtitle: 'Press Command Enter to rename',
                    title: `Rename to “${name}”`,
                  },
                ]
              : [],
            title: 'Rename',
          },
        ],
        title: 'Rename Thread',
      };
    }

    return {
      id: 'root',
      placeholder: 'Search Canary...',
      sections: rootSections,
      title: 'Command Center',
    };
  }

  function rootSections(): PaletteSection[] {
    const recent = recents
      .map((id) => all.get(id))
      .filter(isItem)
      .filter((item) => accepts(item, query));
    const used = new Set(recent.map((item) => item.id));
    const routes = filter(navs, query).filter((item) => !used.has(item.id));
    const hits = filter(thread, query)
      .filter((item) => !used.has(item.id))
      .slice(0, term ? 10 : 7);
    const showCreate = accepts(create, query) && !used.has(create.id);
    const workspace = filter(work, query).filter((item) => !used.has(item.id));

    return [
      { id: 'recent', items: recent, title: 'Recent' },
      { id: 'go', items: routes, title: 'Go to' },
      { id: 'threads', items: showCreate ? [create, ...hits] : hits, title: 'Threads' },
      { id: 'workspace', items: workspace, title: 'Workspace' },
    ];
  }

  function openThread(id: string) {
    close();

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

    close();

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

  function renameThread(id: string, value: string) {
    const name = value.trim();

    if (!name) {
      return;
    }

    col.update(id, (draft) => {
      draft.title = name;
      draft.updatedAt = new Date().toISOString();
    });

    close();
  }

  function archiveThread(id: string) {
    const fallback = id === active ? after(threads, id) : null;

    col.update(id, (draft) => {
      draft.archivedAt = new Date().toISOString();
    });

    close();

    if (id !== active) {
      return;
    }

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

  async function signoutUser() {
    close();
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  return (
    <CommandDialog
      className={cn('w-[min(44rem,calc(100vw-2rem))] max-w-176! sm:max-w-176!', className)}
      description="Search navigation, conversations, and workspace actions."
      open={open}
      title="Canary command palette"
      onOpenChange={onOpenChange}
      {...props}
    >
      <Elevated
        data-command-palette-frame=""
        offset={0}
        shadowLevel={6}
        className="max-h-[min(42rem,calc(100vh-2rem))] overflow-hidden rounded-xl border border-border"
      >
        <Command
          disablePointerSelection
          label="Canary command palette"
          loop
          shouldFilter={false}
          value={value}
          className="bg-transparent p-0"
          onKeyDown={key}
          onMouseDown={mouse}
          onValueChange={setValue}
        >
          <div className={cn('grid min-h-0', actions && 'pointer-events-none select-none')}>
            <section className="flex min-h-0 min-w-0 flex-col">
              <div>
                <CommandInput
                  autoFocus
                  ref={input}
                  showIcon={false}
                  wrapperClassName={page !== 'root' ? 'border-b-0' : undefined}
                  placeholder={view().placeholder}
                  value={query}
                  onValueChange={setQuery}
                />

                {page !== 'root' ? (
                  <div className="flex items-center gap-2 border-b border-border/65 px-3 pb-2 text-[10px] text-muted-foreground">
                    <PaletteButton
                      className="h-6 rounded-md px-1.5"
                      size="xs"
                      type="button"
                      variant="ghost"
                      onClick={back}
                    >
                      <ArrowBendUpLeftIcon data-icon="inline-start" />
                      Back
                    </PaletteButton>
                    <Badge>{view().title}</Badge>
                  </div>
                ) : null}
              </div>

              <CommandList className="scrollbar-visible max-h-[min(27rem,calc(100vh-13rem))] p-1">
                {empty ? <PaletteEmpty query={query} /> : null}

                {sections.map((section) => (
                  <CommandGroup heading={section.title} key={section.id}>
                    <div className="grid gap-1">
                      {section.items.map((item) => (
                        <PaletteCommandItem
                          item={item}
                          key={item.id}
                          onPick={(pick) => setValue(pick.id)}
                          onRun={choose}
                        />
                      ))}
                    </div>
                  </CommandGroup>
                ))}
              </CommandList>
            </section>
          </div>

          <PaletteFooter
            blocked={actions && !!selected}
            item={selected}
            open={actions && !!selected}
            page={page}
            title={view().title}
            onOpenChange={setActions}
            onRun={act}
          />
        </Command>
      </Elevated>
    </CommandDialog>
  );
}

type ShellCommandTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'children' | 'onClick' | 'size' | 'type'
> & {
  compact?: boolean;
  onOpen: () => void;
};

function ShellCommandTrigger({
  className,
  compact = false,
  onOpen,
  ...props
}: ShellCommandTriggerProps) {
  if (compact) {
    return (
      <Button
        aria-label="Open command palette"
        className={cn(
          'size-10 rounded-md border border-transparent bg-transparent text-muted-foreground',
          'hover:border-transparent hover:text-foreground',
          'focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20',
          raised(),
          className,
        )}
        size="icon"
        type="button"
        variant="ghost"
        {...props}
        onClick={onOpen}
      >
        <MagnifyingGlassIcon aria-hidden />
      </Button>
    );
  }

  return (
    <Button
      className={cn(
        'h-9 w-full justify-start gap-2 rounded-md border-input/70 bg-transparent px-3 text-muted-foreground hover:text-foreground',
        raised(),
        className,
      )}
      size="lg"
      type="button"
      variant="outline"
      {...props}
      onClick={onOpen}
    >
      <MagnifyingGlassIcon aria-hidden data-icon="inline-start" />
      <span className="min-w-0 flex-1 text-left">Command palette</span>
      <Shortcut />
    </Button>
  );
}

type PaletteButtonProps = ComponentPropsWithRef<typeof Button>;

function PaletteButton({ className, onMouseDown, ref, ...props }: PaletteButtonProps) {
  return (
    <Button
      ref={ref}
      className={cn('bg-transparent hover:text-foreground', raised(), className)}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.(event);
      }}
      {...props}
    />
  );
}

type PaletteGlyphProps = ComponentPropsWithoutRef<'span'>;

function PaletteGlyph({ className, ...props }: PaletteGlyphProps) {
  const base = useSurface();

  return (
    <span
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground',
        surfaceClasses(base + 1, 1),
        className,
      )}
      {...props}
    />
  );
}

type PaletteKbdProps = ComponentPropsWithoutRef<typeof Kbd>;

function PaletteKbd({ className, ...props }: PaletteKbdProps) {
  const base = useSurface();

  return (
    <Kbd
      className={cn(
        'border border-border/70 text-foreground/75',
        surfaceClasses(base + 1, 1),
        className,
      )}
      {...props}
    />
  );
}

function raised() {
  return cn(
    surfaceState.hover,
    surfaceState.active,
    surfaceState.focus,
    surfaceState.open,
    'hover:!shadow-none focus-visible:!shadow-none aria-expanded:!shadow-none',
    'hover:ring-1 hover:ring-border/70 aria-expanded:ring-1 aria-expanded:ring-border/70',
  );
}

function PaletteCommandItem(props: {
  item: PaletteItem;
  onPick: (item: PaletteItem) => void;
  onRun: (item: PaletteItem) => void;
}) {
  const Icon = props.item.icon;
  const shortcut = props.item.actions.length > 1 ? 'Actions →' : props.item.actions[0]?.shortcut;
  const click = useRef(false);

  return (
    <CommandItem
      className={cn(
        'h-10 min-h-10 gap-0 px-0 py-0 data-selected:hover:bg-active!',
        surfaceState.hover,
      )}
      keywords={props.item.keywords}
      value={props.item.id}
      onClickCapture={() => {
        click.current = true;
      }}
      onDoubleClick={() => props.onRun(props.item)}
      onSelect={() => {
        if (click.current) {
          click.current = false;
          props.onPick(props.item);
          return;
        }

        props.onRun(props.item);
      }}
    >
      <span className="grid size-10 shrink-0 place-items-center">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="grid min-w-0 flex-1 pr-2">
        <span className="truncate">{props.item.title}</span>
        {props.item.subtitle ? (
          <span className="truncate text-[10px] leading-4 text-muted-foreground">
            {props.item.subtitle}
          </span>
        ) : null}
      </span>
      {shortcut ? <CommandShortcut className="mr-2.5">{shortcut}</CommandShortcut> : null}
    </CommandItem>
  );
}

function PaletteFooter(props: {
  blocked: boolean;
  item: PaletteItem | null;
  onOpenChange: (open: boolean) => void;
  onRun: (action: PaletteAction) => void;
  open: boolean;
  page: PalettePageId;
  title: string;
}) {
  const Icon = props.item?.icon ?? CommandIcon;
  const action = props.item?.actions[0]?.title ?? 'Open Command';

  return (
    <Elevated
      data-command-palette-footer=""
      shadowLevel={2}
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 border-t border-border/75 px-3 py-2 text-xs text-muted-foreground',
        props.blocked && 'pointer-events-none select-none',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <PaletteGlyph>
          <Icon aria-hidden className="size-3.5" />
        </PaletteGlyph>
        <span className="truncate font-medium">{props.title}</span>
      </span>
      <div className="flex shrink-0 items-center gap-3">
        {props.page !== 'root' ? (
          <span className="hidden items-center gap-1.5 sm:flex">
            <span>Back</span>
            <PaletteKbd>⌫</PaletteKbd>
          </span>
        ) : null}
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="font-medium text-foreground">{action}</span>
          <PaletteKbd>↵</PaletteKbd>
        </span>
        <Separator className="h-4 bg-border/70" orientation="vertical" />
        <Popover open={props.open} onOpenChange={props.onOpenChange}>
          <PopoverTrigger
            render={
              <PaletteButton
                aria-label="Open command actions"
                className="h-7 rounded-md px-1.5 text-xs font-medium text-muted-foreground disabled:opacity-50"
                disabled={!props.item}
                size="xs"
                type="button"
                variant="ghost"
              />
            }
          >
            Actions
            <KbdGroup className="ml-1">
              <PaletteKbd>⌘</PaletteKbd>
              <PaletteKbd>K</PaletteKbd>
            </KbdGroup>
          </PopoverTrigger>
          {props.item ? (
            <ActionPopover
              item={props.item}
              open={props.open}
              onOpenChange={props.onOpenChange}
              onRun={props.onRun}
            />
          ) : null}
        </Popover>
      </div>
    </Elevated>
  );
}

function ActionPopover(props: {
  item: PaletteItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (action: PaletteAction) => void;
}) {
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const actions = props.item.actions.filter((action) => actionAccepts(action, query));

  useEffect(() => {
    setQuery('');
    setPos(0);
  }, [props.item.id]);

  useEffect(() => {
    setPos((value) => Math.min(value, Math.max(0, actions.length - 1)));
  }, [actions.length]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const id = requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(id);
  }, [props.item.id, props.open]);

  function key(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      props.onOpenChange(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPos((value) => (actions.length ? (value + 1) % actions.length : 0));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPos((value) => (actions.length ? (value - 1 + actions.length) % actions.length : 0));
      return;
    }

    if (event.key !== 'Enter' || !actions[pos]) {
      return;
    }

    event.preventDefault();
    props.onRun(actions[pos]);
  }

  function mouse(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) {
      return;
    }

    event.preventDefault();
    input.current?.focus({ preventScroll: true });
  }

  return (
    <PopoverContent
      align="end"
      side="top"
      sideOffset={10}
      className="w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-transparent p-0 shadow-none ring-0"
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={mouse}
    >
      <Elevated shadowLevel={2} className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border/65 px-2.5 py-2">
          <p className="truncate text-xs font-medium text-muted-foreground">{props.item.title}</p>
        </div>

        <div className="grid max-h-56 gap-1 overflow-y-auto p-2">
          {actions.length ? (
            actions.map((action, index) => (
              <ActionRow
                action={action}
                active={index === pos}
                key={action.id}
                onPick={() => setPos(index)}
                onRun={props.onRun}
              />
            ))
          ) : (
            <p className="px-2 py-5 text-center text-xs text-muted-foreground">
              No matching actions.
            </p>
          )}
        </div>

        <div className="border-t border-border/75 bg-surface-3/80 px-2.5">
          <input
            autoFocus
            ref={input}
            aria-label="Search command actions"
            className="h-8 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            placeholder="Search for actions..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={key}
          />
        </div>
      </Elevated>
    </PopoverContent>
  );
}

function ActionRow(props: {
  action: PaletteAction;
  active: boolean;
  onPick: () => void;
  onRun: (action: PaletteAction) => void;
}) {
  const Icon = props.action.icon;
  const row = (
    <Button
      className={cn(
        'grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-0 rounded-md bg-transparent! py-0 pl-0 pr-3 text-xs hover:bg-transparent! active:translate-y-0!',
        props.active && 'text-foreground',
        props.action.tone === 'danger' && 'text-destructive hover:text-destructive',
      )}
      size="sm"
      type="button"
      variant="ghost"
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onPick}
      onDoubleClick={() => props.onRun(props.action)}
    >
      <span className="grid size-8 shrink-0 place-items-center">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0 truncate pr-3 text-left">{props.action.title}</span>
      {props.action.shortcut ? <ActionKeys value={props.action.shortcut} /> : null}
    </Button>
  );

  return (
    <div
      className={cn(
        'rounded-md border',
        props.active
          ? cn('border-border/70 hover:bg-active!', surfaceState.selected)
          : cn('border-transparent', surfaceState.hover),
      )}
    >
      {row}
    </div>
  );
}

function ActionKeys(props: { value: string }) {
  return (
    <KbdGroup className="justify-end">
      {props.value.split(/\s+/).map((item) => (
        <PaletteKbd className="h-4 min-w-4 px-1 text-[10px]" key={item}>
          {keyLabel(item)}
        </PaletteKbd>
      ))}
    </KbdGroup>
  );
}

function PaletteEmpty(props: { query: string }) {
  return (
    <Empty className="border-0 p-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MagnifyingGlassIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No command found</EmptyTitle>
        <EmptyDescription>
          Nothing matches {props.query.trim() ? `“${props.query.trim()}”` : 'this view'}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>Try a thread title, route, theme action, or account action.</EmptyContent>
    </Empty>
  );
}

function PaletteCard(props: { label: string; title: string; value: string }) {
  return (
    <Elevated shadowLevel={1} className="rounded-md border border-input/60 p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{props.label}</p>
      <p className="mt-1 truncate text-xs font-medium text-foreground">{props.title}</p>
      <p className="truncate text-[10px] text-muted-foreground">{props.value}</p>
    </Elevated>
  );
}

function AccountDetail(props: { user: ShellUser }) {
  return (
    <div className="grid gap-2">
      <PaletteCard
        label="Account"
        title={props.user.name ?? 'Canary user'}
        value={props.user.email ?? 'Local session'}
      />
      <PaletteCard label="Sync" title="Realtime sync" value="Electric local cache" />
    </div>
  );
}

function ThreadDetail(props: { row: ThreadRecord }) {
  return (
    <div className="grid gap-2">
      <PaletteCard
        label="Thread"
        title={props.row.title.trim() || 'Untitled thread'}
        value={props.row.id}
      />
      <PaletteCard label="Updated" title={stamp(props.row.updatedAt)} value={props.row.updatedAt} />
      <PaletteCard label="Created" title={stamp(props.row.createdAt)} value={props.row.createdAt} />
    </div>
  );
}

function Shortcut() {
  return (
    <KbdGroup aria-hidden className="ml-auto gap-1">
      <Kbd className="size-5 min-w-5 bg-background/40 p-0 text-[11px]">
        <CommandIcon />
      </Kbd>
      <Kbd className="size-5 min-w-5 bg-background/40 p-0 text-[11px]">K</Kbd>
    </KbdGroup>
  );
}

function filter(items: PaletteItem[], query: string) {
  return items.filter((item) => accepts(item, query));
}

function accepts(item: PaletteItem, query: string) {
  const term = norm(query);

  if (!term) {
    return true;
  }

  return [item.title, item.subtitle ?? '', item.source, ...item.keywords].some((value) =>
    norm(value).includes(term),
  );
}

function actionAccepts(action: PaletteAction, query: string) {
  const term = norm(query);

  if (!term) {
    return true;
  }

  return [action.title, action.shortcut ?? ''].some((value) => norm(value).includes(term));
}

function keyLabel(value: string) {
  switch (value) {
    case 'Enter':
      return '↵';
    case 'Command':
    case 'Mod':
    case '⌘':
      return '⌘';
    default:
      return value;
  }
}

function isItem(value: PaletteItem | undefined): value is PaletteItem {
  return value !== undefined;
}

function renameId(page: PalettePageId) {
  return page.startsWith('rename:') ? page.slice('rename:'.length) : null;
}

function isScreen(value: string | null): value is PaletteScreen {
  return SCREENS.some((item) => item === value);
}

function stack(page: PaletteScreen): PalettePageId[] {
  return page === 'root' ? ['root'] : ['root', page];
}

function readScreen() {
  const value = localStorage.getItem(SCREEN);

  return isScreen(value) ? value : 'root';
}

function writeScreen(value: PalettePageId) {
  if (isScreen(value)) {
    localStorage.setItem(SCREEN, value);
  }
}

function readRecents() {
  const value = localStorage.getItem(RECENTS);

  if (!value) {
    return [];
  }

  try {
    const data: unknown = JSON.parse(value);

    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeRecents(value: string[]) {
  localStorage.setItem(RECENTS, JSON.stringify(value));
}

function after(rows: ThreadRecord[], id: string) {
  const index = rows.findIndex((row) => row.id === id);

  if (index < 0) {
    return rows[0] ?? null;
  }

  return rows[index + 1] ?? rows[index - 1] ?? null;
}

function sorted(rows: ThreadRecord[]) {
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

  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const mins = Math.floor(diff / 60_000);

  if (mins < 1) {
    return 'now';
  }

  if (mins < 60) {
    return `${mins}m`;
  }

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

function norm(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

export { ShellCommandPalette, ShellCommandTrigger };
export type {
  PaletteAction,
  PaletteContext,
  PaletteItem,
  PalettePage,
  PaletteSection,
  ShellCommandPaletteProps,
  ShellCommandTriggerProps,
};
