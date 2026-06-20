import { Link } from '@tanstack/react-router';

import { ModeToggle } from '~/components/mode-toggle';
import { authClient } from '~/lib/auth-client';

export default function Header() {
  const session = authClient.useSession();
  const links = [
    { to: '/', label: 'Home' },
    { to: '/threads', label: 'Threads' },
  ] as const;

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
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.data.user.email}
            </span>
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
