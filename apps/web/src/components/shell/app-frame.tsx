import type { ReactNode } from 'react';

import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import type { ShellUser } from '~/components/shell/model';

import { ChatSidebar } from '~/components/shell/chat-sidebar';
import { MobileSidebar } from '~/components/shell/mobile-sidebar';
import { PrimaryMobile, PrimarySidebar } from '~/components/shell/primary-sidebar';
import { cn } from '~/lib/utils';
import { setup } from '~/utils/chat';

function AppFrame(props: { children: ReactNode; user: ShellUser }) {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const path = useRouterState({ select: (state) => state.location.pathname });
  const chat = path === '/threads' || path.startsWith('/threads/');
  const side = ready && chat ? <ChatSidebar user={props.user} /> : null;

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
    <div className="canary-shell h-svh overflow-hidden p-2 text-foreground md:p-3">
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2 md:flex md:gap-0">
        <MobileSidebar>
          <div className="grid gap-4">
            <PrimaryMobile ready={ready} user={props.user} />
            {side}
          </div>
        </MobileSidebar>
        <div className="hidden h-full min-h-0 shrink-0 pr-[var(--shell-gap)] md:block">
          <PrimarySidebar
            open={open}
            ready={ready}
            user={props.user}
            onToggle={() => setOpen((state) => !state)}
          />
        </div>
        <SecondarySlot open={!!side}>{side}</SecondarySlot>
        <main className="canary-panel min-h-0 overflow-hidden rounded-[var(--radius-shell)] md:flex-1">
          {ready ? props.children : <SyncScreen />}
        </main>
      </div>
    </div>
  );
}

function SecondarySlot(props: { children: ReactNode; open: boolean }) {
  return (
    <aside
      aria-hidden={!props.open}
      className={cn(
        'hidden min-h-0 shrink-0 overflow-hidden transition-[width,margin-right] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none md:block',
        props.open ? 'mr-[var(--shell-gap)] w-[18rem]' : 'mr-0 w-0',
      )}
    >
      <div
        className={cn(
          'canary-panel h-full w-full overflow-hidden rounded-[var(--radius-shell)] p-3 transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] motion-reduce:transition-none',
          props.open ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0',
        )}
      >
        {props.children}
      </div>
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

export { AppFrame };
