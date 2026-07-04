import { ArrowRightIcon, SignOutIcon, UserCircleIcon } from '@phosphor-icons/react';

import type { ShellCommandDeps, ThemeChoice } from '~/components/shell/command-modules/types';

import {
  Command,
  CommandCard,
  createCommandIds,
  defineCommandModule,
} from '~/components/command-palette';
import { AccountDetail } from '~/components/shell/command-modules/details';
import { themeIcon, themeName } from '~/components/shell/command-modules/utils';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';

const ids = createCommandIds('workspace');

const workspaceModule = defineCommandModule({
  id: 'workspace',
  useData: (deps: ShellCommandDeps) => deps.mode,
  render: (mode, deps) => ({
    pages: (
      <>
        <Command.Page id={ids.page('theme')} placeholder="Choose appearance..." title="Theme">
          <Command.Section id={ids.section('theme')} title="Appearance">
            {(['light', 'dark', 'system'] satisfies ThemeChoice[]).map((item) =>
              themeItem(deps, item),
            )}
          </Command.Section>
        </Command.Page>

        <Command.Page
          id={ids.page('account')}
          placeholder="Search account actions..."
          title="Account"
        >
          <Command.Section id={ids.section('account')} title="Account">
            <Command.Item
              icon={UserCircleIcon}
              id={ids.item('account-detail')}
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
              id={ids.item('account-theme')}
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
                page={ids.page('theme')}
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
      <Command.Section id={ids.section('root')} title="Workspace">
        <Command.Item
          icon={themeIcon(mode)}
          id={ids.item('theme')}
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
            page={ids.page('theme')}
            shortcut="Enter"
          >
            Open
          </Command.Action.Push>
        </Command.Item>

        <Command.Item
          icon={UserCircleIcon}
          id={ids.item('account')}
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
            page={ids.page('account')}
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

function themeItem(deps: ShellCommandDeps, value: ThemeChoice) {
  const Icon = themeIcon(value);
  const active = deps.mode === value;

  return (
    <Command.Item
      icon={Icon}
      id={ids.item('theme', value)}
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
      id={ids.item(scope, 'signout')}
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

async function signout(deps: ShellCommandDeps, ctx: { close: () => void }) {
  ctx.close();
  await authClient.signOut();
  deps.router.options.context.queryClient.setQueryData(userKey, null);
  await deps.router.invalidate();
}

export { workspaceModule };
