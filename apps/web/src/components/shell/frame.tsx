import type { ComponentPropsWithoutRef } from 'react';

import { useEffect, useState } from 'react';

import type { ShellUser } from '~/components/shell/routes';

import { ShellCommandPalette } from '~/components/shell/command-palette';
import { MobileDrawer } from '~/components/shell/mobile-drawer';
import { Sidebar } from '~/components/shell/sidebar';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';
import { setup } from '~/utils/chat';

type ShellFrameProps = ComponentPropsWithoutRef<'div'> & {
  user: ShellUser;
};

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

  const sidebar = <Sidebar ready={ready} user={user} onCommand={() => setPalette(true)} />;

  return (
    <div
      className={cn('canary-shell h-svh overflow-hidden p-2 text-foreground md:p-3', className)}
      {...props}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2 md:flex md:gap-(--shell-gap)">
        <MobileDrawer>{sidebar}</MobileDrawer>

        <Elevated
          shadowLevel={2}
          className="hidden h-full min-h-0 w-[16.5rem] shrink-0 overflow-hidden rounded-(--radius-shell) border border-sidebar-border p-2 text-sidebar-foreground md:block"
        >
          {sidebar}
        </Elevated>

        <main className="canary-panel min-h-0 overflow-hidden rounded-(--radius-shell) md:flex-1">
          {ready ? children : <Sync />}
        </main>

        <ShellCommandPalette open={palette} user={user} onOpenChange={setPalette} />
      </div>
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
