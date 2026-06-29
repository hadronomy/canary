import type { ComponentPropsWithoutRef } from 'react';

import { CaretDownIcon as ChevronDownIcon, SignOutIcon } from '@phosphor-icons/react';

import type { ShellUser } from '~/components/shell/routes';

import { ModeToggle } from '~/components/mode-toggle';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

type AccountPanelProps = ComponentPropsWithoutRef<'div'> & {
  onSignout: () => void;
  user: ShellUser;
};

function AccountPanel({ className, onSignout, user, ...props }: AccountPanelProps) {
  return (
    <Elevated
      shadowLevel={1}
      className={cn(
        'min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-input/70 p-2',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-3 rounded-(--radius-control) bg-background/35 p-2">
        <UserAvatar className="size-10" ready size="lg" user={user} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-[-0.01em]">
            {user.name ?? 'Canary user'}
          </p>
          <p className="truncate text-[11px] leading-4 text-muted-foreground">
            {user.email ?? 'Local session'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ModeToggle className="size-8 border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground" />
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </div>
      </div>
      <Button
        className="mt-1 h-8 w-full justify-start rounded-(--radius-press) px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        size="sm"
        type="button"
        variant="ghost"
        onClick={onSignout}
      >
        <SignOutIcon data-icon="inline-start" />
        Sign out
      </Button>
    </Elevated>
  );
}

export { AccountPanel };
export type { AccountPanelProps };
