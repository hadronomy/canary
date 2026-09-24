import { useLiveQuery } from '@tanstack/react-db';
import { useRouter } from '@tanstack/react-router';

import type { ShellUser } from '~/components/shell/routes';

import { Account } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { Nav } from '~/components/shell/nav';
import { Threads } from '~/components/shell/threads';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';
import { cn } from '~/lib/utils';
import { roster } from '~/utils/chat';

type SidebarProps = {
  className?: string;
  ready: boolean;
  user: ShellUser;
};

/**
 * One column for everything that is not the conversation: who you are, where
 * you can go, and what you have already said.
 *
 * It draws no surface of its own. The window behind it is the surface, and the
 * only thing here that lifts off it is whichever row is active — which is what
 * makes that row findable without a highlight colour doing the work.
 */
function Sidebar({ className, ready, user }: SidebarProps) {
  const router = useRouter();
  const threads = useLiveQuery(roster(user.id)).data;

  async function signout() {
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  return (
    // One rhythm down the column: 12px between the brand, the destinations,
    // the threads and the account. The account sits on the window like every
    // other row rather than behind a rule — a line across the sidebar is a
    // second way of saying "this is a different section", after the space has
    // already said it.
    <div className={cn('grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-3 py-1', className)}>
      <Brand />

      <Nav />

      <Threads user={user} />

      <footer>
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
