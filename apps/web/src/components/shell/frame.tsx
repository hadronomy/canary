import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import type { ShellAside, ShellUser } from '~/components/shell/routes';

import { ShellCommandPalette } from '~/components/shell/command-palette';
import { MobileDrawer } from '~/components/shell/mobile-drawer';
import { DesktopNav, MobileNav } from '~/components/shell/nav';
import { shellFromMatches } from '~/components/shell/routes';
import { ThreadSidebar } from '~/components/shell/threads';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';
import { setup } from '~/utils/chat';

type ShellFrameProps = ComponentPropsWithoutRef<'div'> & {
  user: ShellUser;
};

function ShellFrame({ children, className, user, ...props }: ShellFrameProps) {
  const [palette, setPalette] = useState(false);
  const [ready, setReady] = useState(false);

  const shell = useRouterState({
    select: (state) => shellFromMatches(state.matches),
  });

  const aside = ready ? renderAside(shell?.aside, user) : null;

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

  return (
    <div
      className={cn('canary-shell h-svh overflow-hidden p-2 text-foreground md:p-3', className)}
      {...props}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2 md:flex md:gap-0">
        <MobileDrawer>
          <div className="grid gap-4">
            <MobileNav ready={ready} user={user} onCommand={() => setPalette(true)} />
            {aside}
          </div>
        </MobileDrawer>

        <div className="hidden h-full min-h-0 shrink-0 pr-(--shell-gap) md:block">
          <DesktopNav ready={ready} user={user} onCommand={() => setPalette(true)} />
        </div>

        <SecondarySlot open={!!aside}>{aside}</SecondarySlot>

        <main className="canary-panel min-h-0 overflow-hidden rounded-(--radius-shell) md:flex-1">
          {ready ? children : <SyncScreen />}
        </main>

        <ShellCommandPalette open={palette} user={user} onOpenChange={setPalette} />
      </div>
    </div>
  );
}

function renderAside(aside: ShellAside | undefined, user: ShellUser) {
  switch (aside) {
    case 'threads':
      return <ThreadSidebar user={user} />;
    default:
      return null;
  }
}

function SecondarySlot(props: { children: ReactNode; open: boolean }) {
  return (
    <aside
      aria-hidden={!props.open}
      className={cn(
        'hidden min-h-0 shrink-0 overflow-hidden transition-[width,margin-right] duration-200 ease-out-strong motion-reduce:transition-none md:block',
        props.open ? 'mr-(--shell-gap) w-[18rem]' : 'mr-0 w-0',
      )}
    >
      <Elevated
        shadowLevel={2}
        className={cn(
          'h-full w-full overflow-hidden rounded-(--radius-shell) border border-sidebar-border p-3 text-sidebar-foreground transition-[opacity,transform] duration-150 ease-out-strong motion-reduce:transition-none',
          props.open ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0',
        )}
      >
        {props.children}
      </Elevated>
    </aside>
  );
}

function SyncScreen() {
  return (
    <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
      Preparing local sync...
    </div>
  );
}

export { ShellFrame };
export type { ShellFrameProps };
