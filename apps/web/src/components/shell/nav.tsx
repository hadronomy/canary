import type { ComponentPropsWithoutRef, ReactElement } from 'react';

import { useLiveQuery } from '@tanstack/react-db';
import { Link, useRouter } from '@tanstack/react-router';

import type { ShellNavRoute, ShellUser } from '~/components/shell/routes';

import { AccountPanel } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { ShellCommandTrigger } from '~/components/shell/command-palette';
import { primaryNav } from '~/components/shell/routes';
import { SyncStatus } from '~/components/shell/status';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';
import { roster } from '~/utils/chat';

type DesktopNavProps = Omit<ComponentPropsWithoutRef<'aside'>, 'children'> & {
  onCommand: () => void;
  ready: boolean;
  user: ShellUser;
};

type MobileNavProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  onCommand: () => void;
  ready: boolean;
  user: ShellUser;
};

function DesktopNav({ className, onCommand, ready, user, ...props }: DesktopNavProps) {
  return (
    <aside
      className={cn('relative hidden h-full min-h-0 w-[72px] shrink-0 md:block', className)}
      {...props}
    >
      <Elevated
        shadowLevel={2}
        className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-5 overflow-hidden rounded-(--radius-shell) border border-sidebar-border p-4 text-sidebar-foreground"
      >
        <Header />

        <Tip label="Command palette">
          <ShellCommandTrigger compact onOpen={onCommand} />
        </Tip>

        <nav aria-label="Primary navigation" className="grid content-start gap-1">
          {primaryNav.map((item) => (
            <SideLink item={item} key={item.to} />
          ))}
        </nav>

        <Footer compact ready={ready} user={user} />
      </Elevated>
    </aside>
  );
}

function MobileNav({ className, onCommand, ready, user, ...props }: MobileNavProps) {
  return (
    <div className={cn('grid gap-3', className)} {...props}>
      <Brand />

      <ShellCommandTrigger onOpen={onCommand} />

      <nav aria-label="Primary navigation" className="grid content-start gap-1">
        {primaryNav.map((item) => (
          <MobileLink item={item} key={item.to} />
        ))}
      </nav>

      <Footer ready={ready} user={user} />
    </div>
  );
}

function Header() {
  return (
    <div className="grid size-10 place-items-center">
      <Brand compact />
    </div>
  );
}

function SideLink(props: { item: ShellNavRoute }) {
  const Icon = props.item.icon;

  const node = (
    <Link
      activeOptions={{ exact: props.item.nav.exact }}
      activeProps={{
        className: 'border-input/70 bg-surface-3 text-foreground shadow-surface-1',
      }}
      aria-label={props.item.label}
      className={cn(
        'group relative flex size-10 items-center justify-center rounded-(--radius-control) border border-transparent text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong motion-reduce:transition-none',
        'hover:border-input/55 hover:bg-surface-3/70 hover:text-foreground',
        'focus-visible:border-ring/50 focus-visible:bg-surface-3/70 focus-visible:ring-2 focus-visible:ring-ring/20',
      )}
      to={props.item.to}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
    </Link>
  );

  return <Tip label={props.item.label}>{node}</Tip>;
}

function MobileLink(props: { item: ShellNavRoute }) {
  const Icon = props.item.icon;

  return (
    <Link
      activeOptions={{ exact: props.item.nav.exact }}
      activeProps={{
        className: 'border-input/70 bg-surface-3 text-foreground shadow-surface-1',
      }}
      className={cn(
        'flex h-10 items-center gap-3 rounded-(--radius-control) border border-transparent px-3 text-sm font-medium text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong motion-reduce:transition-none',
        'hover:border-input/55 hover:bg-surface-3/70 hover:text-foreground',
      )}
      to={props.item.to}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className="truncate">{props.item.label}</span>
    </Link>
  );
}

function Footer(props: { compact?: boolean; ready?: boolean; user: ShellUser }) {
  const router = useRouter();
  const threads = useLiveQuery(roster(props.user.id)).data;

  async function signout() {
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  if (props.compact) {
    return (
      <footer className="grid justify-items-center gap-3">
        <Separator className="w-8 bg-input/70" />
        <RailAccount
          ready={props.ready ?? true}
          threads={threads.length}
          user={props.user}
          onSignout={signout}
        />
      </footer>
    );
  }

  if (props.ready === false) {
    return <SyncPanel />;
  }

  return (
    <footer className="grid min-w-0 gap-2 overflow-hidden">
      <SyncStatus threads={threads.length} />
      <AccountPanel user={props.user} onSignout={signout} />
    </footer>
  );
}

function RailAccount(props: {
  onSignout: () => void;
  ready: boolean;
  threads: number;
  user: ShellUser;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label="Account and sync"
            className={cn(
              'size-10 rounded-full border border-transparent bg-transparent p-0 text-muted-foreground',
              'hover:border-input/55 hover:bg-surface-3/70 hover:text-foreground',
              'focus-visible:border-ring/50 focus-visible:bg-surface-3/70 focus-visible:ring-2 focus-visible:ring-ring/20',
            )}
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <UserAvatar className="size-8" ready={props.ready} user={props.user} />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-72 rounded-lg border border-border bg-popover p-2 shadow-surface-5"
        side="right"
        sideOffset={12}
      >
        {props.ready ? <SyncStatus threads={props.threads} /> : <SyncPanel />}
        <AccountPanel user={props.user} onSignout={props.onSignout} />
      </PopoverContent>
    </Popover>
  );
}

function SyncPanel() {
  return (
    <div className="grid rounded-(--radius-control) border border-border bg-card/80 p-3 text-xs text-muted-foreground">
      Preparing local sync...
    </div>
  );
}

function Tip(props: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

export { DesktopNav, MobileNav };
export type { DesktopNavProps, MobileNavProps };
