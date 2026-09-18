import { useLiveQuery } from '@tanstack/react-db';
import { useRouter } from '@tanstack/react-router';

import type { ShellUser } from '~/components/shell/routes';

import { Account } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { ShellCommandTrigger } from '~/components/shell/command-palette';
import { Nav } from '~/components/shell/nav';
import { Threads } from '~/components/shell/threads';
import { Separator } from '~/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { cn } from '~/lib/utils';
import { roster } from '~/utils/chat';

type SidebarProps = {
  className?: string;
  onCommand: () => void;
  ready: boolean;
  user: ShellUser;
};

/**
 * One column for everything that is not the conversation: who you are, where
 * you can go, and what you have already said.
 *
 * It replaced an icon rail plus a separate thread panel. Two columns meant the
 * sidebar's width changed depending on the route, which made the main panel
 * jump on every navigation between a thread and anything else.
 */
function Sidebar({ className, onCommand, ready, user }: SidebarProps) {
  const router = useRouter();
  const threads = useLiveQuery(roster(user.id)).data;

  async function signout() {
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  return (
    <div className={cn('grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-2', className)}>
      <header className="flex items-center justify-between gap-2">
        <Brand />

        <Tooltip>
          <TooltipTrigger
            render={<ShellCommandTrigger compact className="size-8" onOpen={onCommand} />}
          />
          <TooltipContent side="bottom">Command palette</TooltipContent>
        </Tooltip>
      </header>

      <Nav />

      <Threads user={user} />

      <footer className="grid gap-1">
        <Separator />
        <Account
          ready={ready}
          threads={threads.length}
          user={user}
          onSignout={() => {
            signout().catch((err: unknown) => {
              console.error('Sign out failed.', err);
            });
          }}
        />
      </footer>
    </div>
  );
}

export { Sidebar };
export type { SidebarProps };
