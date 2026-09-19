import type { ChangeEvent, ReactElement } from 'react';

import {
  ArrowsClockwiseIcon as CycleIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { useLiveQuery } from '@tanstack/react-db';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Thread } from '@canary/sync';
import type { ShellUser } from '~/components/shell/routes';
import type { ThreadState } from '~/components/shell/thread-row';

import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { ScrollArea } from '~/components/ui/scroll-area';
import { Skeleton } from '~/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Morph } from '~/lib/motion';
import { cn } from '~/lib/utils';
import { list, roster, states } from '~/utils/chat';

type ThreadGroup = {
  id: 'today' | 'recent' | 'older';
  label: string;
  threads: Thread[];
};

const DAY_MS = 86_400_000;

/**
 * Every thread the local cache holds, grouped by how recently it moved.
 *
 * Creating is not here: it is the first nav row, because naming a thread before
 * you know what it is about produces worse names than the first message does.
 */
function Threads({ className, user }: { className?: string; user: ShellUser }) {
  const nav = useNavigate();
  const params = useParams({ strict: false });

  const owner = user.id;
  const active = typeof params.threadId === 'string' ? params.threadId : null;

  const frame = useRef<number | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [debug, setDebug] = useState(false);

  const threadCollection = list(owner);
  const rosterQuery = useLiveQuery(roster(owner));
  const runs = useLiveQuery(states(owner)).data;

  // Newest run wins. The query is already ordered, so the first row seen for a
  // thread is its current state and every later one is history.
  const marks = useMemo(() => {
    const seen = new Map<string, ThreadState>();

    for (const run of runs) {
      if (!seen.has(run.threadId)) {
        seen.set(run.threadId, mark(run.status));
      }
    }

    return seen;
  }, [runs]);

  const threads = useMemo(() => live(rosterQuery.data), [rosterQuery.data]);
  const search = useMemo(() => matcher(query), [query]);

  const visible = useMemo(
    () => (search.on ? threads.filter((thread) => search.hit(thread)) : threads),
    [search, threads],
  );

  const groups = useMemo(() => group(visible), [visible]);

  const jump = useCallback(
    (direction: number) => {
      const next = byOffset(visible, active, direction);

      if (!next) {
        return;
      }

      nav({
        to: '/threads/$threadId',
        params: {
          threadId: next.id,
        },
      }).catch((err: unknown) => {
        console.error('Thread hotkey navigation failed.', err);
      });
    },
    [active, nav, visible],
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
    if (debug || visible.length < 2) {
      return;
    }

    const ids = visible.map((thread) => thread.id);
    const index = active ? ids.indexOf(active) : -1;
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
  }, [active, debug, nav, visible]);

  const archive = useCallback(
    (id: string) => {
      const fallback = id === active ? afterRemoving(visible, id) : null;

      threadCollection.update(id, (draft) => {
        draft.archivedAt = new Date().toISOString();
      });

      if (id !== active) {
        return;
      }

      if (fallback) {
        nav({
          to: '/threads/$threadId',
          params: {
            threadId: fallback.id,
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
    [active, nav, threadCollection, visible],
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);

    if (next) {
      // After the track starts growing, so focus does not land in a zero-height
      // field and scroll the sidebar to chase it.
      requestAnimationFrame(() => field.current?.focus());
      return;
    }

    setQuery('');
  }

  return (
    <section className={cn('grid min-h-0 grid-rows-[auto_auto_1fr] gap-1', className)}>
      <header className="flex h-8 items-center justify-between gap-2 px-2.5">
        <h2 className="truncate text-sm text-muted-foreground">Threads</h2>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tip label={open ? 'Hide search' : 'Search threads'}>
            <Button
              aria-expanded={open}
              aria-label={open ? 'Hide search' : 'Search threads'}
              className="size-6 text-muted-foreground"
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={toggle}
            >
              <MagnifyingGlassIcon />
            </Button>
          </Tip>

          {threads.length > 1 ? (
            <Tip label="Cycle threads">
              <Button
                aria-busy={debug || undefined}
                aria-label="Cycle threads"
                className={cn('size-6 text-muted-foreground', debug && 'animate-pulse')}
                disabled={debug}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={cycle}
              >
                <CycleIcon />
              </Button>
            </Tip>
          ) : null}
        </div>
      </header>

      <div className="t-grow px-1" data-open={open}>
        <div>
          <div className="pb-1.5">
            <label className="sr-only" htmlFor="thread-search">
              Search threads
            </label>
            <Input
              ref={field}
              id="thread-search"
              autoComplete="off"
              className="h-8"
              placeholder="Search threads"
              spellCheck={false}
              tabIndex={open ? undefined : -1}
              type="search"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      <ScrollArea
        className="-mx-1 min-h-0 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]"
        cueSize="tight"
        viewportClassName="px-1 pr-2 pb-8"
      >
        <nav aria-label="Conversations">
          {!rosterQuery.isReady ? (
            <Pending />
          ) : visible.length ? (
            <div className="grid gap-3">
              {groups.map((entry) => (
                <section key={entry.id} aria-labelledby={`threads-${entry.id}`}>
                  <div className="mb-0.5 flex items-center gap-1.5 px-2.5">
                    <FolderSimpleIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground/70"
                    />
                    <h3
                      className="min-w-0 truncate text-xs text-muted-foreground"
                      id={`threads-${entry.id}`}
                    >
                      {entry.label}
                    </h3>
                    <Morph className="text-xs tabular-nums text-muted-foreground/60">
                      {entry.threads.length}
                    </Morph>
                  </div>

                  <div className="grid gap-px">
                    {entry.threads.map((thread, index) => (
                      <ThreadRow
                        active={thread.id === active}
                        id={thread.id}
                        index={index}
                        key={thread.id}
                        state={marks.get(thread.id)}
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
            <Blank filtering={search.on} query={query} onClear={() => setQuery('')} />
          )}
        </nav>
      </ScrollArea>
    </section>
  );
}

function Pending() {
  return (
    <div className="grid gap-px" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton className="h-[2.75rem] rounded-(--radius-control) bg-surface-3/60" key={index} />
      ))}
    </div>
  );
}

function Blank(props: { filtering: boolean; query: string; onClear: () => void }) {
  if (props.filtering) {
    return (
      <div className="px-2 py-3">
        <p className="text-xs text-foreground">No matches</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Nothing here matches “{props.query.trim()}”.
        </p>
        <Button
          className="mt-2 h-6 px-2 text-[11px]"
          size="sm"
          type="button"
          variant="secondary"
          onClick={props.onClear}
        >
          Clear search
        </Button>
      </div>
    );
  }

  return (
    <div className="px-2 py-3">
      <p className="text-xs text-foreground">No threads yet</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        Start one from New thread and the first message names it.
      </p>
    </div>
  );
}

function Tip(props: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}

function mark(status: string): ThreadState {
  if (status === 'running' || status === 'queued') {
    return 'running';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'completed') {
    return 'done';
  }

  return 'idle';
}

function live(threads: Thread[]) {
  return threads
    .filter((thread) => !thread.archivedAt)
    .toSorted(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

function matcher(query: string) {
  const value = flatten(query);

  return {
    on: value.length > 0,
    hit: (thread: Thread) =>
      flatten(`${thread.title} ${thread.id} ${thread.createdAt} ${thread.updatedAt}`).includes(
        value,
      ),
  };
}

function flatten(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function group(threads: Thread[]) {
  const groups: ThreadGroup[] = [
    { id: 'today', label: 'Today', threads: [] },
    { id: 'recent', label: 'Recent', threads: [] },
    { id: 'older', label: 'Older', threads: [] },
  ];

  for (const thread of threads) {
    groups[bucket(thread.updatedAt)]?.threads.push(thread);
  }

  return groups.filter((entry) => entry.threads.length > 0);
}

function bucket(date: Date) {
  const today = midnight(new Date());
  const updated = midnight(date);
  const days = Math.floor((today.getTime() - updated.getTime()) / DAY_MS);

  if (days <= 0) {
    return 0;
  }

  if (days < 14) {
    return 1;
  }

  return 2;
}

function midnight(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function byOffset(threads: Thread[], active: string | null, direction: number) {
  if (!threads.length) {
    return null;
  }

  const index = active ? threads.findIndex((thread) => thread.id === active) : -1;
  const base = index >= 0 ? index : direction > 0 ? -1 : 0;
  const next = threads[(base + direction + threads.length) % threads.length];

  if (!next || next.id === active) {
    return null;
  }

  return next;
}

function afterRemoving(threads: Thread[], removed: string) {
  const index = threads.findIndex((thread) => thread.id === removed);

  if (index < 0) {
    return threads[0] ?? null;
  }

  return threads[index + 1] ?? threads[index - 1] ?? null;
}

export { Threads };
