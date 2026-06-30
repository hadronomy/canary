import type { Icon } from '@phosphor-icons/react';
import type { useNavigate, useRouter } from '@tanstack/react-router';

import {
  ArrowRightIcon,
  CopyIcon,
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

import type { ShellUser } from '~/components/shell/routes';
import type { useTheme } from '~/components/theme-provider';
import type { list } from '~/utils/chat';

import {
  Command,
  CommandCard,
  createCommandIds,
  defineCommandModule,
  definePalette,
} from '~/components/command-palette';
import { primaryNav } from '~/components/shell/routes';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';

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

const navIds = createCommandIds('navigation');
const threadIds = createCommandIds('threads');
const workIds = createCommandIds('workspace');

const navigationModule = defineCommandModule({
  id: 'navigation',
  useData: () => primaryNav,
  render: (routes, deps: ShellCommandDeps) => ({
    sections: (
      <Command.Section id="navigation" title="Go to">
        {routes.map((route) => {
          const active = deps.path === route.to || deps.path.startsWith(`${route.to}/`);
          const Icon = route.icon;

          return (
            <Command.Item
              icon={Icon}
              id={navIds.item(route.area)}
              key={route.area}
              keywords={[route.area, route.label, String(route.to)]}
              source="navigation"
              subtitle={active ? 'Current location' : 'Navigate'}
              title={route.label}
            >
              <Command.Detail>
                <CommandCard
                  label="Route"
                  title={route.label}
                  value={active ? 'Current location' : String(route.to)}
                />
              </Command.Detail>

              <Command.Action
                icon={ArrowRightIcon}
                id="open"
                shortcut="Enter"
                run={(ctx) => {
                  ctx.close();
                  return deps.nav({ to: route.to }).catch((err: unknown) => {
                    console.error('Command palette navigation failed.', err);
                  });
                }}
              >
                {active ? 'Stay here' : 'Open'}
              </Command.Action>
            </Command.Item>
          );
        })}
      </Command.Section>
    ),
  }),
});

const threadsModule = defineCommandModule({
  id: 'threads',
  useData: (deps: ShellCommandDeps) => deps.threads,
  render: (threads, deps) => ({
    pages: (
      <>
        <Command.Page
          id={threadIds.page('search')}
          placeholder="Search conversations..."
          title="Threads"
        >
          <Command.Section id="threads-page" title="Threads">
            {threads.map((row) => threadItem(deps, row, 'search'))}
          </Command.Section>
        </Command.Page>

        <Command.Page
          id={threadIds.page('create')}
          placeholder="Name the new thread..."
          title="Create Thread"
        >
          <Command.Section id="thread-create" title="Create">
            <Command.Item
              icon={PlusIcon}
              id={threadIds.item('create-submit')}
              keywords={['new', 'create', 'chat', 'thread']}
              source="thread"
              subtitle="Press Command Enter to create"
              title="Create thread"
            >
              <Command.Detail>
                <CommandCard label="Thread" title="Create thread" value="Uses the current query" />
              </Command.Detail>

              <Command.Action
                icon={PlusIcon}
                id="submit"
                shortcut="Mod+Enter"
                submit
                run={(ctx) => createThread(deps, ctx.query)}
              >
                Create thread
              </Command.Action>
            </Command.Item>
          </Command.Section>
        </Command.Page>

        {threads.map((row) => renamePage(deps, row))}
      </>
    ),
    sections: (
      <Command.Section id="threads" title="Threads">
        <Command.Item
          icon={MagnifyingGlassIcon}
          id={threadIds.item('search')}
          keywords={['conversation', 'chat', 'history', 'threads']}
          source="thread"
          subtitle={`${threads.length} searchable conversations`}
          title="Search threads"
        >
          <Command.Detail>
            <CommandCard
              label="Threads"
              title="Search conversations"
              value={`${threads.length} synced conversations`}
            />
          </Command.Detail>

          <Command.Action.Push
            icon={ArrowRightIcon}
            id="open"
            page={threadIds.page('search')}
            shortcut="Enter"
          >
            Open
          </Command.Action.Push>
        </Command.Item>

        <Command.Item
          icon={PlusIcon}
          id={threadIds.item('create')}
          keywords={['new', 'create', 'chat', 'thread']}
          source="thread"
          subtitle="Prepare a fresh conversation"
          title="Create new thread"
        >
          <Command.Detail>
            <CommandCard label="Thread" title="Create thread" value="Name it from search" />
          </Command.Detail>

          <Command.Action
            icon={ArrowRightIcon}
            id="open"
            shortcut="Enter"
            run={(ctx) => ctx.page(threadIds.page('create'), ctx.query)}
          >
            Open create thread
          </Command.Action>
        </Command.Item>

        {threads.map((row) => threadItem(deps, row))}
      </Command.Section>
    ),
  }),
});

const workspaceModule = defineCommandModule({
  id: 'workspace',
  useData: (deps: ShellCommandDeps) => deps.mode,
  render: (mode, deps) => ({
    pages: (
      <>
        <Command.Page id={workIds.page('theme')} placeholder="Choose appearance..." title="Theme">
          <Command.Section id="theme" title="Appearance">
            {(['light', 'dark', 'system'] satisfies ThemeChoice[]).map((item) =>
              themeItem(deps, item),
            )}
          </Command.Section>
        </Command.Page>

        <Command.Page
          id={workIds.page('account')}
          placeholder="Search account actions..."
          title="Account"
        >
          <Command.Section id="account" title="Account">
            <Command.Item
              icon={UserCircleIcon}
              id={workIds.item('account-detail')}
              keywords={['profile', 'user', 'sync', 'session']}
              source="workspace"
              subtitle={deps.user.email ?? deps.user.name ?? 'Local session'}
              title="Account details"
            >
              <Command.Detail>
                <AccountDetail user={deps.user} />
              </Command.Detail>

              <Command.Action
                icon={UserCircleIcon}
                id="open"
                shortcut="Enter"
                run={(ctx) => ctx.actions()}
              >
                Show details
              </Command.Action>
            </Command.Item>

            <Command.Item
              icon={themeIcon(mode)}
              id={workIds.item('account-theme')}
              keywords={['appearance', 'theme']}
              source="workspace"
              subtitle={themeName(mode)}
              title="Theme settings"
            >
              <Command.Detail>
                <CommandCard label="Appearance" title={themeName(mode)} value="Current theme" />
              </Command.Detail>

              <Command.Action.Push
                icon={ArrowRightIcon}
                id="open"
                page={workIds.page('theme')}
                shortcut="Enter"
              >
                Open
              </Command.Action.Push>
            </Command.Item>

            {signoutItem(deps, 'account')}
          </Command.Section>
        </Command.Page>
      </>
    ),
    sections: (
      <Command.Section id="workspace" title="Workspace">
        <Command.Item
          icon={themeIcon(mode)}
          id={workIds.item('theme')}
          keywords={['appearance', 'light', 'dark', 'system']}
          source="workspace"
          subtitle={`Current: ${themeName(mode)}`}
          title="Theme"
        >
          <Command.Detail>
            <CommandCard label="Appearance" title={themeName(mode)} value="Current theme" />
          </Command.Detail>

          <Command.Action.Push
            icon={ArrowRightIcon}
            id="open"
            page={workIds.page('theme')}
            shortcut="Enter"
          >
            Open
          </Command.Action.Push>
        </Command.Item>

        <Command.Item
          icon={UserCircleIcon}
          id={workIds.item('account')}
          keywords={['profile', 'user', 'sync', 'session']}
          source="workspace"
          subtitle={deps.user.email ?? deps.user.name ?? 'Local session'}
          title="Account and sync"
        >
          <Command.Detail>
            <AccountDetail user={deps.user} />
          </Command.Detail>

          <Command.Action.Push
            icon={ArrowRightIcon}
            id="open"
            page={workIds.page('account')}
            shortcut="Enter"
          >
            Open
          </Command.Action.Push>
        </Command.Item>

        {signoutItem(deps, 'root')}
      </Command.Section>
    ),
  }),
});

const shellPalette = definePalette<ShellCommandDeps>({
  hotkeys: {
    toggle: 'Mod+K',
  },
  id: 'shell',
  modules: [navigationModule, threadsModule, workspaceModule],
  root: 'root',
});

function shellCommandTree(deps: ShellCommandDeps) {
  const nav = navigationModule.render(navigationModule.useData(deps), deps);
  const threads = threadsModule.render(threadsModule.useData(deps), deps);
  const work = workspaceModule.render(workspaceModule.useData(deps), deps);

  return (
    <>
      <Command.Page id="root" placeholder="Search Canary..." title="Command Center">
        {nav.sections}
        {threads.sections}
        {work.sections}
      </Command.Page>

      {nav.pages}
      {threads.pages}
      {work.pages}
    </>
  );
}

function threadItem(deps: ShellCommandDeps, row: ThreadRecord, scope = 'root') {
  const name = row.title.trim() || 'Untitled thread';
  const short = row.id.slice(0, 8);

  return (
    <Command.Item
      icon={MagnifyingGlassIcon}
      id={threadIds.item(scope, row.id)}
      key={row.id}
      keywords={[row.id, row.title, row.createdAt, row.updatedAt, short]}
      source="thread"
      subtitle={`${stamp(row.updatedAt)} · ${short}`}
      title={name}
    >
      <Command.Detail>
        <ThreadDetail row={row} />
      </Command.Detail>

      <Command.Action
        icon={ArrowRightIcon}
        id="open"
        shortcut="Enter"
        run={() => open(deps, row.id)}
      >
        Open thread
      </Command.Action>
      <Command.Action.Push
        icon={PencilSimpleIcon}
        id="rename"
        page={threadIds.page('rename', row.id)}
        query={name}
      >
        Rename thread
      </Command.Action.Push>
      <Command.Action.Copy icon={CopyIcon} id="copy-title" value={name}>
        Copy title
      </Command.Action.Copy>
      <Command.Action.Copy icon={CopyIcon} id="copy-id" value={row.id}>
        Copy id
      </Command.Action.Copy>
      <Command.Action.Danger
        icon={TrayArrowDownIcon}
        id="archive"
        run={() => archive(deps, row.id)}
      >
        Archive thread
      </Command.Action.Danger>
    </Command.Item>
  );
}

function renamePage(deps: ShellCommandDeps, row: ThreadRecord) {
  const name = row.title.trim() || 'Untitled thread';

  return (
    <Command.Page
      id={threadIds.page('rename', row.id)}
      key={row.id}
      placeholder="Rename thread..."
      title="Rename Thread"
    >
      <Command.Section id={threadIds.item('rename', row.id)} title="Rename">
        <Command.Item
          icon={PencilSimpleIcon}
          id={threadIds.item('rename-submit', row.id)}
          keywords={[row.id, row.title]}
          source="thread"
          subtitle="Press Command Enter to rename"
          title="Rename thread"
        >
          <Command.Detail>
            <ThreadDetail row={row} />
          </Command.Detail>

          <Command.Action
            icon={PencilSimpleIcon}
            id="submit"
            shortcut="Mod+Enter"
            submit
            run={(ctx) => rename(deps, row.id, ctx.query || name)}
          >
            Rename thread
          </Command.Action>
        </Command.Item>
      </Command.Section>
    </Command.Page>
  );
}

function themeItem(deps: ShellCommandDeps, value: ThemeChoice) {
  const Icon = themeIcon(value);
  const active = deps.mode === value;

  return (
    <Command.Item
      icon={Icon}
      id={workIds.item('theme', value)}
      key={value}
      keywords={['appearance', 'theme', value]}
      source="workspace"
      subtitle={active ? 'Current theme' : 'Switch appearance'}
      title={themeName(value)}
    >
      <Command.Detail>
        <CommandCard
          label="Appearance"
          title={themeName(value)}
          value={active ? 'Currently selected' : 'Switch Canary appearance'}
        />
      </Command.Detail>

      <Command.Action
        icon={Icon}
        id="apply"
        shortcut="Enter"
        run={(ctx) => {
          deps.theme.setTheme(value);
          ctx.close();
        }}
      >
        {active ? 'Keep selected' : 'Apply theme'}
      </Command.Action>
    </Command.Item>
  );
}

function signoutItem(deps: ShellCommandDeps, scope: string) {
  return (
    <Command.Item
      icon={SignOutIcon}
      id={workIds.item(scope, 'signout')}
      keywords={['logout', 'session']}
      source="workspace"
      subtitle={deps.user.email ?? 'End the current session'}
      title="Sign out"
    >
      <Command.Detail>
        <CommandCard
          label="Workspace"
          title="Sign out"
          value={deps.user.email ?? 'End the current session'}
        />
      </Command.Detail>

      <Command.Action
        icon={SignOutIcon}
        id="run"
        shortcut="Enter"
        run={(ctx) => signout(deps, ctx)}
      >
        Sign out
      </Command.Action>
    </Command.Item>
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

function open(deps: ShellCommandDeps, id: string) {
  deps.onOpenChange(false);

  return deps
    .nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    })
    .catch((err: unknown) => {
      console.error('Command palette thread navigation failed.', err);
    });
}

function createThread(deps: ShellCommandDeps, value: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = value.trim() || 'New thread';
  const tx = deps.col.insert({
    id,
    ownerId: deps.user.id,
    title,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  deps.onOpenChange(false);

  return deps
    .nav({
      to: '/threads/$threadId',
      params: { threadId: id },
    })
    .then(() => tx.isPersisted.promise)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error('Command palette thread create failed.', err);
    });
}

function rename(deps: ShellCommandDeps, id: string, value: string) {
  const title = value.trim();

  if (!title) return;

  deps.col.update(id, (draft) => {
    draft.title = title;
    draft.updatedAt = new Date().toISOString();
  });

  deps.onOpenChange(false);
}

function archive(deps: ShellCommandDeps, id: string) {
  const fallback = id === deps.active ? after(deps.threads, id) : null;

  deps.col.update(id, (draft) => {
    draft.archivedAt = new Date().toISOString();
  });

  deps.onOpenChange(false);

  if (id !== deps.active) return;

  if (fallback) {
    return deps
      .nav({
        to: '/threads/$threadId',
        params: { threadId: fallback.id },
        replace: true,
      })
      .catch((err: unknown) => {
        console.error('Command palette archive navigation failed.', err);
      });
  }

  return deps
    .nav({
      to: '/threads',
      replace: true,
    })
    .catch((err: unknown) => {
      console.error('Command palette archive navigation failed.', err);
    });
}

async function signout(deps: ShellCommandDeps, ctx: { close: () => void }) {
  ctx.close();
  await authClient.signOut();
  deps.router.options.context.queryClient.setQueryData(userKey, null);
  await deps.router.invalidate();
}

function after(rows: readonly ThreadRecord[], id: string) {
  const at = rows.findIndex((row) => row.id === id);

  if (at < 0) return rows[0] ?? null;

  return rows[at + 1] ?? rows[at - 1] ?? null;
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

export { currentTheme, shellCommandTree, shellPalette, sorted };
export type { ShellCommandDeps, ThemeChoice, ThreadRecord };
