import { CaretUpIcon, SignOutIcon } from '@phosphor-icons/react';

import type { ShellUser } from '~/components/shell/routes';

import { ModeToggle } from '~/components/mode-toggle';
import { SyncStatus } from '~/components/shell/status';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

type AccountProps = {
  className?: string;
  onSignout: () => void;
  ready: boolean;
  threads: number;
  user: ShellUser;
};

/**
 * The sidebar's last row: who is signed in, and the way out.
 *
 * It is a row rather than a panel because it is the one thing in the sidebar
 * nobody came here to use. Everything it opens — sync state, theme, sign out —
 * lives in the popover, where it costs no standing space.
 */
function Account({ className, onSignout, ready, threads, user }: AccountProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label="Account and sync"
            className={cn(
              'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-(--radius-control) border border-transparent px-2 text-left',
              'transition-[background-color,border-color,color] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
              surfaceState.hover,
              surfaceState.focus,
              surfaceState.open,
              'focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20',
              className,
            )}
            type="button"
          />
        }
      >
        <UserAvatar className="size-7" ready={ready} size="sm" user={user} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-foreground">
            {user.name ?? 'Canary user'}
          </span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
            {user.email ?? 'Local session'}
          </span>
        </span>

        <CaretUpIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64" side="top" sideOffset={8}>
        {ready ? <SyncStatus threads={threads} /> : <SyncPanel />}

        <Separator />

        <div className="grid gap-0.5">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-xs text-muted-foreground">Appearance</span>
            <ModeToggle className="size-7" />
          </div>

          <Button
            className="h-8 w-full justify-start px-2 text-muted-foreground hover:text-foreground"
            type="button"
            variant="ghost"
            onClick={onSignout}
          >
            <SignOutIcon data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SyncPanel() {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">Preparing local sync…</p>;
}

export { Account };
export type { AccountProps };
