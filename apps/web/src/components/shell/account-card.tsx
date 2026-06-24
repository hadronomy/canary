import type { ShellUser } from '~/components/shell/model';

import { ChevronDownIcon, SignOutIcon } from '~/components/icons';
import { ModeToggle } from '~/components/mode-toggle';
import { UserAvatar } from '~/components/shell/user-avatar';
import { Button } from '~/components/ui/button';

function AccountCard(props: { onSignout: () => void; user: ShellUser }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-white/10 bg-[linear-gradient(145deg,oklch(1_0_0_/_5%),oklch(1_0_0_/_1%))] p-2 shadow-[inset_0_1px_0_oklch(1_0_0_/_7%)]">
      <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] bg-black/20 p-2">
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
          <ModeToggle className="size-8 border-white/10 bg-white/[0.035] text-muted-foreground hover:bg-row hover:text-foreground" />
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </div>
      </div>
      <Button
        className="mt-1 h-8 w-full justify-start rounded-[var(--radius-press)] px-2 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
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
