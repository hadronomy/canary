import type { ComponentPropsWithoutRef } from 'react';

import { useEffect, useState } from 'react';

import type { ShellUser } from '~/components/shell/routes';

import { ShellCommandPalette } from '~/components/shell/command-palette';
import { MobileDrawer } from '~/components/shell/mobile-drawer';
import { Sidebar } from '~/components/shell/sidebar';
import { cn } from '~/lib/utils';
import { setup } from '~/utils/chat';

type ShellFrameProps = ComponentPropsWithoutRef<'div'> & {
  user: ShellUser;
};

/**
 * The window, and the one panel floating in it.
 *
 * The sidebar has no surface of its own — it sits directly on the window, so
 * the navigation reads as part of the frame rather than as another card. Only
 * the conversation is a panel: inset on every side, its own corners, one
 * hairline. That is the whole hierarchy, and it means the panel can hold
 * full-bleed artwork without a second background showing through behind it.
 *
 * Giving the sidebar a fill and a divider instead put three surfaces on screen
 * to express a split that this expresses with one.
 */
function ShellFrame({ children, className, user, ...props }: ShellFrameProps) {
  const [palette, setPalette] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;

    setup()
      .then(() => {
        if (live) {
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        console.error('TanStack DB setup failed.', err);

        if (live) {
          setReady(true);
        }
      });

    return () => {
      live = false;
    };
  }, []);

  const sidebar = <Sidebar ready={ready} user={user} />;

  return (
    <div
      className={cn(
        'grid h-svh grid-rows-[auto_1fr] gap-2 overflow-hidden bg-background p-2 text-foreground',
        'md:grid-cols-[15.5rem_minmax(0,1fr)] md:grid-rows-1 md:gap-0',
        className,
      )}
      {...props}
    >
      <MobileDrawer>{sidebar}</MobileDrawer>

      <aside className="hidden h-full min-h-0 pr-2 md:block">{sidebar}</aside>

      <main className="min-h-0 overflow-hidden rounded-(--radius-shell) border border-border bg-surface-2 shadow-surface-2">
        {ready ? children : <Sync />}
      </main>

      <ShellCommandPalette open={palette} user={user} onOpenChange={setPalette} />
    </div>
  );
}

function Sync() {
  return (
    <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
      Preparing local sync…
    </div>
  );
}

export { ShellFrame };
export type { ShellFrameProps };
