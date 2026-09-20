import { CaretUpIcon, SignOutIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import type { ShellUser } from '~/components/shell/routes';

import { Sync, summary } from '~/components/shell/status';
import { UserAvatar } from '~/components/shell/user-avatar';
import { useTheme } from '~/components/theme-provider';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { Spin, Swap } from '~/lib/motion';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

type AccountProps = {
  className?: string;
  onSignout: () => void;
  ready: boolean;
  threads: number;
  user: ShellUser;
};

/** How long an armed sign-out waits before giving up on being confirmed. */
const ARMED = 3200;

/**
 * The sidebar's last row: who is signed in, what the cache is doing, and the
 * way out.
 *
 * The second line is the sync state rather than the email address. An email is
 * a thing you need once, to answer "which account is this" — it does not
 * change, and spending the row's only other line on it means the one fact here
 * that *does* change had to be looked up in a menu. The address moves into the
 * popover, where being asked for is the point.
 *
 * It is a row rather than a panel because it is the one thing in the sidebar
 * nobody came here to use.
 */
function Account({ className, onSignout, ready, threads, user }: AccountProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            aria-label="Account, sync and sign out"
            className={cn(
              'group/account flex h-11 w-full min-w-0 items-center gap-2.5 rounded-(--radius-control) border border-transparent px-2 text-left',
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
        <UserAvatar className="size-7" size="sm" user={user} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-foreground">
            {user.name ?? 'Canary user'}
          </span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            <Swap value={summary(ready, threads)} />
          </span>
        </span>

        {/* The caret answers "what happens if I press this". Rotating it on
            open is the cheapest way to make it answer "and what is it doing
            now" as well. */}
        <CaretUpIcon
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground',
            'transition-transform duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-68" side="top" sideOffset={8}>
        <header className="flex min-w-0 items-center gap-2.5 px-2 py-1.5">
          <UserAvatar className="size-8" user={user} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {user.name ?? 'Canary user'}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {user.email ?? 'Local session'}
            </span>
          </span>
        </header>

        <Separator />

        <Sync ready={ready} threads={threads} />

        <Separator />

        <Appearance />

        <Separator />

        <Signout open={open} onSignout={onSignout} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sign out, armed before it fires.
 *
 * A single click that ends the session is the wrong amount of friction for
 * something sitting at the bottom of every screen, and a modal is too much —
 * it takes over the page to ask one question. Arming the button in place is
 * the middle: the first press changes what the button says and means, and
 * doing nothing at all undoes it.
 *
 * The label goes through `Swap` rather than switching outright, because the
 * two words are the same size in the same place and the change is easy to miss
 * without the movement carrying it.
 */
function Signout({ onSignout, open }: { onSignout: () => void; open: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);

  // Closing the popover disarms it. Coming back to a button that is still
  // primed from a minute ago is a trap.
  useEffect(() => {
    if (!open) {
      setArmed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!armed) {
      return;
    }

    timer.current = window.setTimeout(() => setArmed(false), ARMED);
    return () => clearTimeout(timer.current);
  }, [armed]);

  return (
    <button
      aria-label={armed ? 'Confirm sign out' : 'Sign out'}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-(--radius-press) px-2 text-left text-xs',
        'transition-[background-color,color] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        'active:scale-[0.99] motion-reduce:active:scale-100',
        armed
          ? 'bg-destructive/12 text-destructive'
          : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        busy && 'pointer-events-none',
      )}
      disabled={busy}
      type="button"
      onClick={() => {
        if (busy) {
          return;
        }

        if (!armed) {
          setArmed(true);
          return;
        }

        clearTimeout(timer.current);
        setBusy(true);
        onSignout();
      }}
    >
      <span aria-hidden className="grid size-4 shrink-0 place-items-center">
        {busy ? <Spin className="size-3.5" /> : <SignOutIcon className="size-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <Swap value={busy ? 'Signing out…' : armed ? 'Tap again to confirm' : 'Sign out'} />
      </span>
    </button>
  );
}

const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
] as const;

/**
 * Theme, as three visible options rather than a menu.
 *
 * This used to be a dropdown inside the popover: a menu opened from a menu to
 * choose between three things, when all three fit on one line. Laid out flat
 * the whole choice is legible at a glance and costs one press instead of two.
 */
function Appearance() {
  const theme = useTheme();

  return (
    <div className="grid gap-1 px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground">Appearance</span>

      <div
        aria-label="Appearance"
        className="grid grid-cols-3 gap-0.5 rounded-(--radius-press) bg-surface-2 p-0.5"
        role="radiogroup"
      >
        {THEMES.map((item) => {
          const on = theme.theme === item.id;

          return (
            <button
              key={item.id}
              aria-checked={on}
              className={cn(
                'h-6 rounded-[calc(var(--radius-press)-2px)] text-[11px]',
                'transition-[background-color,color,box-shadow] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                on
                  ? 'bg-surface-5 text-foreground shadow-surface-1'
                  : 'text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
              role="radio"
              type="button"
              onClick={() => theme.setTheme(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Account };
export type { AccountProps };
