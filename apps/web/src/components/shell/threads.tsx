import { useLiveQuery } from '@tanstack/react-db';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ShellUser } from '~/components/shell/routes';

import { ThreadActions } from '~/components/shell/thread-actions';
import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '~/components/ui/empty';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import { list, roster } from '~/utils/chat';

type ThreadRecord = {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
};

type ThreadGroupId = 'today' | 'recent' | 'older';

type ThreadGroup = {
  id: ThreadGroupId;
  label: string;
  threads: ThreadRecord[];
};

const DAY_MS = 86_400_000;

type ThreadSidebarProps = Omit<ComponentPropsWithoutRef<'aside'>, 'children'> & {
  user: ShellUser;
};

function ThreadSidebar({ className, user, ...props }: ThreadSidebarProps) {
  const nav = useNavigate();
  const params = useParams({ strict: false });

  const ownerId = user.id;
  const activeThreadId = typeof params.threadId === 'string' ? params.threadId : null;

  const frame = useRef<number | null>(null);

  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [debug, setDebug] = useState(false);

  const threadCollection = useMemo(() => list(ownerId), [ownerId]);
  const rosterCollection = useMemo(() => roster(ownerId), [ownerId]);
  const rosterQuery = useLiveQuery(rosterCollection);

  const threads = useMemo(() => sortedActiveThreads(rosterQuery.data), [rosterQuery.data]);
  const search = useMemo(() => createThreadSearch(query), [query]);

  const visibleThreads = useMemo(
    () => (search.active ? threads.filter((thread) => search.matches(thread)) : threads),
    [search, threads],
  );

  const groups = useMemo(() => groupThreads(visibleThreads), [visibleThreads]);

  const status = sidebarStatus({
    filtered: visibleThreads.length,
    filtering: search.active,
    ready: rosterQuery.isReady,
    total: threads.length,
  });

  const jump = useCallback(
    (direction: number) => {
      const nextThread = threadByOffset(visibleThreads, activeThreadId, direction);

      if (!nextThread) {
        return;
      }

      nav({
        to: '/threads/$threadId',
        params: {
          threadId: nextThread.id,
        },
      }).catch((err: unknown) => {
        console.error('Thread hotkey navigation failed.', err);
      });
    },
    [activeThreadId, nav, visibleThreads],
  );

  useHotkey('Alt+ArrowUp', () => jump(-1), {
    ignoreInputs: false,
    preventDefault: true,
  });

  useHotkey('Alt+ArrowDown', () => jump(1), {
    ignoreInputs: false,
    preventDefault: true,
  });

  const cycle = useCallback(() => {
    if (debug || visibleThreads.length < 2) {
      return;
    }

    const ids = visibleThreads.map((thread) => thread.id);
    const index = activeThreadId ? ids.indexOf(activeThreadId) : -1;
    const start = index >= 0 ? index : 0;
    const total = ids.length * 3;

    let step = 0;

    setDebug(true);

    function next() {
      step += 1;

      const id = ids[(start + step) % ids.length];

      if (!id) {
        frame.current = null;
        setDebug(false);
        return;
      }

      nav({
        to: '/threads/$threadId',
        params: {
          threadId: id,
        },
        replace: true,
      }).catch((err: unknown) => {
        console.error('Thread debug navigation failed.', err);
      });

      if (step >= total) {
        frame.current = null;
        setDebug(false);
        return;
      }

      frame.current = requestAnimationFrame(next);
    }

    frame.current = requestAnimationFrame(next);
  }, [activeThreadId, debug, nav, visibleThreads]);

  const create = useCallback(() => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = title.trim() || 'New thread';

    const tx = threadCollection.insert({
      id,
      ownerId,
      title: name,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    setTitle('');
    setQuery('');

    nav({
      to: '/threads/$threadId',
      params: {
        threadId: id,
      },
    })
      .then(() => tx.isPersisted.promise)
      .catch((err: unknown) => {
        setTitle((current) => current || name);
        console.error('Thread create failed.', err);
      });
  }, [nav, ownerId, threadCollection, title]);

  const archive = useCallback(
    (id: string) => {
      const fallbackThread = id === activeThreadId ? threadAfterRemoving(visibleThreads, id) : null;

      threadCollection.update(id, (draft) => {
        draft.archivedAt = new Date().toISOString();
      });

      if (id !== activeThreadId) {
        return;
      }

      if (fallbackThread) {
        nav({
          to: '/threads/$threadId',
          params: {
            threadId: fallbackThread.id,
          },
          replace: true,
        }).catch((err: unknown) => {
          console.error('Thread archive navigation failed.', err);
        });

        return;
      }

      nav({
        to: '/threads',
        replace: true,
      }).catch((err: unknown) => {
        console.error('Thread archive navigation failed.', err);
      });
    },
    [activeThreadId, nav, threadCollection, visibleThreads],
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  return (
    <aside
      className={cn('grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-3', className)}
      {...props}
    >
      <header className="px-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
              Chat
            </h2>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">{status}</p>
          </div>

          <span
            className="rounded-md border border-input/70 bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground"
            title="Alt + Arrow Up / Alt + Arrow Down"
          >
            ⌥↑↓
          </span>
        </div>
      </header>

      <ThreadActions
        cycleDisabled={visibleThreads.length < 2}
        debug={debug}
        query={query}
        title={title}
        onCreate={create}
        onCycle={cycle}
        onQuery={setQuery}
        onTitle={setTitle}
      />

      <nav aria-label="Chat conversations" className="min-h-0 overflow-y-auto pr-1.5">
        {!rosterQuery.isReady ? (
          <ThreadSkeletonList />
        ) : visibleThreads.length ? (
          <div className="grid gap-3">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`threads-${group.id}`}>
                <div className="mb-1.5 flex items-center justify-between px-1.5">
                  <h3
                    className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/72"
                    id={`threads-${group.id}`}
                  >
                    {group.label}
                  </h3>
                  <span className="text-[10px] tabular-nums text-muted-foreground/62">
                    {group.threads.length}
                  </span>
                </div>

                <div className="grid gap-1.5">
                  {group.threads.map((thread) => (
                    <ThreadRow
                      active={thread.id === activeThreadId}
                      id={thread.id}
                      key={thread.id}
                      title={thread.title}
                      updated={thread.updatedAt}
                      onArchive={archive}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState filtering={search.active} query={query} onClearQuery={() => setQuery('')} />
        )}
      </nav>
    </aside>
  );
}

function ThreadSkeletonList() {
  return (
    <div className="grid gap-1.5" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton
          className="h-[3.35rem] rounded-(--radius-control) border border-input/50 bg-surface-3/70"
          key={index}
        />
      ))}
    </div>
  );
}

function EmptyState(props: { filtering: boolean; query: string; onClearQuery: () => void }) {
  if (props.filtering) {
    return (
      <Empty className="items-start gap-2 rounded-(--radius-control) border border-input/60 bg-surface-3/70 p-3 text-left">
        <EmptyHeader className="items-start gap-1">
          <EmptyTitle className="truncate text-xs">No results</EmptyTitle>
          <EmptyDescription className="truncate text-[11px]">
            Nothing matches “{props.query.trim()}”.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="items-start">
          <Button
            className="h-7 rounded-(--radius-press) px-2 text-[11px]"
            size="sm"
            type="button"
            variant="secondary"
            onClick={props.onClearQuery}
          >
            Clear search
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty className="items-start gap-1 rounded-(--radius-control) border border-input/60 bg-surface-3/70 p-3 text-left">
      <EmptyHeader className="items-start gap-1">
        <EmptyTitle className="text-xs">No conversations yet</EmptyTitle>
        <EmptyDescription className="text-[11px]">
          Name one above, or press create to start with a default title.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function sidebarStatus(input: {
  filtered: number;
  filtering: boolean;
  ready: boolean;
  total: number;
}) {
  if (!input.ready) {
    return 'Syncing conversations…';
  }

  if (!input.total) {
    return 'No conversations yet';
  }

  if (input.filtering) {
    return `${input.filtered} of ${input.total} conversations`;
  }

  return `${input.total} synced conversations`;
}

function sortedActiveThreads(threads: ThreadRecord[]) {
  return threads
    .filter((thread) => !thread.archivedAt)
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

function createThreadSearch(query: string) {
  const value = normalizeSearchText(query);

  return {
    active: value.length > 0,
    matches: (thread: ThreadRecord) =>
      normalizeSearchText(
        `${thread.title} ${thread.id} ${thread.createdAt} ${thread.updatedAt}`,
      ).includes(value),
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function groupThreads(threads: ThreadRecord[]) {
  const groups: ThreadGroup[] = [
    { id: 'today', label: 'Today', threads: [] },
    { id: 'recent', label: 'Recent', threads: [] },
    { id: 'older', label: 'Older', threads: [] },
  ];

  for (const thread of threads) {
    groups[groupIndex(thread.updatedAt)]?.threads.push(thread);
  }

  return groups.filter((group) => group.threads.length > 0);
}

function groupIndex(updatedAt: string) {
  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return 2;
  }

  const today = startOfLocalDay(new Date());
  const updated = startOfLocalDay(date);
  const days = Math.floor((today.getTime() - updated.getTime()) / DAY_MS);

  if (days <= 0) {
    return 0;
  }

  if (days < 14) {
    return 1;
  }

  return 2;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function threadByOffset(threads: ThreadRecord[], activeThreadId: string | null, direction: number) {
  if (!threads.length) {
    return null;
  }

  const index = activeThreadId ? threads.findIndex((thread) => thread.id === activeThreadId) : -1;

  const base = index >= 0 ? index : direction > 0 ? -1 : 0;
  const next = threads[(base + direction + threads.length) % threads.length];

  if (!next || next.id === activeThreadId) {
    return null;
  }

  return next;
}

function threadAfterRemoving(threads: ThreadRecord[], removedId: string) {
  const index = threads.findIndex((thread) => thread.id === removedId);

  if (index < 0) {
    return threads[0] ?? null;
  }

  return threads[index + 1] ?? threads[index - 1] ?? null;
}

export { ThreadSidebar };
export type { ThreadSidebarProps };
