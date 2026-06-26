import type { ShellUser } from '~/components/shell/model';

import { ChevronDownIcon, SignOutIcon } from '~/components/icons';
import { ModeToggle } from '~/components/mode-toggle';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';

function AccountCard(props: { onSignout: () => void; user: ShellUser }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-line bg-surface-raised p-2 ">
      <div className="flex min-w-0 items-center gap-3 rounded-(--radius-control) bg-surface/80 p-2">
        <UserAvatar className="size-10" ready size="lg" user={props.user} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-[-0.01em]">
            {props.user.name ?? 'Canary user'}
          </p>
          <p className="truncate text-[11px] leading-4 text-muted-foreground">
            {props.user.email ?? 'Local session'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ModeToggle className="size-8 border-line bg-control text-muted-foreground hover:bg-row hover:text-foreground" />
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </div>
      </div>
      <Button
        className="mt-1 h-8 w-full justify-start rounded-(--radius-press) px-2 text-muted-foreground hover:bg-control hover:text-foreground"
        size="sm"
        type="button"
        variant="ghost"
        onClick={props.onSignout}
      >
        <SignOutIcon data-icon="inline-start" />
        Sign out
      </Button>
    </div>
  );
}

export { AccountCard };
