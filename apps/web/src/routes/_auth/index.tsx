import { ArrowRightIcon, PulseIcon, WarningIcon } from '@phosphor-icons/react';
import { useLiveQuery } from '@tanstack/react-db';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { shellRoutes } from '~/components/shell/routes';
import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import { Morph } from '~/lib/motion';
import { roster } from '~/utils/chat';

export const Route = createFileRoute('/_auth/')({
  loader: async ({ context }) => {
    return await context.queryClient.ensureQueryData(context.orpc.health.check.queryOptions());
  },
  staticData: {
    shell: shellRoutes.home,
  },
  component: Home,
});

/**
 * The landing screen: what is synced, and what you were last working on.
 *
 * Everything here is read from the local cache rather than described in prose,
 * so the page is only ever as confident as the data behind it.
 */
function Home() {
  const health = Route.useLoaderData();
  const ctx = Route.useRouteContext();
  const query = useLiveQuery(roster(ctx.user.id));

  const recent = useMemo(
    () =>
      query.data
        .filter((thread) => !thread.archivedAt)
        .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 6),
    [query.data],
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl gap-8 px-6 py-12">
        <header className="grid gap-2">
          <h1 className="text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
            {greeting()}, {ctx.user.name?.split(' ')[0] ?? 'there'}.
          </h1>
          <p className="text-sm text-muted-foreground">
            <Morph className="tabular-nums">{recent.length}</Morph>
            {recent.length === 1 ? ' thread' : ' threads'} in the local cache.
          </p>
        </header>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-3 px-2">
            <h2 className="text-xs font-medium text-muted-foreground">Continue</h2>
            <Button
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              render={<Link to="/threads" />}
              size="sm"
              variant="ghost"
            >
              New thread
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>

          {recent.length ? (
            <div className="grid gap-px">
              {recent.map((thread, index) => (
                <ThreadRow
                  active={false}
                  id={thread.id}
                  index={index}
                  key={thread.id}
                  title={thread.title}
                  updated={thread.updatedAt}
                  onArchive={() => undefined}
                />
              ))}
            </div>
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Nothing yet. Start a thread and it will show up here.
            </p>
          )}
        </section>

        <footer className="flex items-center gap-2 border-t border-border px-2 pt-4 text-xs text-muted-foreground">
          {health.ok ? (
            <PulseIcon aria-hidden className="size-3.5 text-primary" />
          ) : (
            <WarningIcon aria-hidden className="size-3.5 text-destructive" />
          )}
          <span>{health.ok ? 'API reachable' : 'API unreachable'}</span>
        </footer>
      </div>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();

  if (hour < 5) {
    return 'Still up';
  }

  if (hour < 12) {
    return 'Morning';
  }

  if (hour < 18) {
    return 'Afternoon';
  }

  return 'Evening';
}
