import { Link, useRouter } from '@tanstack/react-router';

import { ModeToggle } from '~/components/mode-toggle';
import { Button } from '~/components/ui/button';
import { userKey } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';

export default function Header() {
  const router = useRouter();
  const session = authClient.useSession();
  const links = [
    { to: '/', label: 'Home' },
    { to: '/threads', label: 'Threads' },
  ] as const;

  async function signout() {
    await authClient.signOut();
    router.options.context.queryClient.setQueryData(userKey, null);
    await router.invalidate();
  }

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {session.data?.user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {session.data.user.email}
              </span>
              <Button size="sm" type="button" variant="ghost" onClick={signout}>
                Sign out
              </Button>
            </>
          ) : (
            <Link className="text-sm" to="/login">
              Login
            </Link>
          )}
          <ModeToggle />
        </div>
      </div>
      <hr />
    </div>
  );
}
