import type { Icon } from '@phosphor-icons/react';
import type { ReactElement, ReactNode } from 'react';

import {
  CaretDownIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SealCheckIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useLiveQuery } from '@tanstack/react-db';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Thread } from '@canary/sync';
import type { ShellUser } from '~/components/shell/routes';
import type { ThreadState } from '~/components/shell/thread-row';
import type { Shelf } from '~/utils/filing';

import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import { ScrollArea } from '~/components/ui/scroll-area';
import { Skeleton } from '~/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Morph } from '~/lib/motion';
import { cn } from '~/lib/utils';
import { list, roster, states } from '~/utils/chat';
import { moved, settle, shelf, snooze } from '~/utils/filing';

type ThreadGroup = {
  id: 'today' | 'recent' | 'older';
  label: string;
  threads: Thread[];
};

const DAY_MS = 86_400_000;

// The strong ease-out the rest of the app moves on.
const EASE = [0.16, 1, 0.3, 1] as const;

// Whether a `Rows` list is still on its first paint.
const Fresh = createContext<{ current: boolean }>({ current: false });

/**
 * Every thread the local cache holds, and the run state of each.
 *
 * Creating is not here: it is the first nav row, because naming a thread before
 * you know what it is about produces worse names than the first message does.
 */
function Threads({ className, user }: { className?: string; user: ShellUser }) {
  const params = useParams({ strict: false });

  const col = list(user.id);
  const rosterQuery = useLiveQuery(roster(user.id));
  const runs = useLiveQuery(states(user.id)).data;

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

  // Filing a thread leaves it open where it is. It is still there to read,
  // and moving someone off the page they are on to say so would be louder
  // than the action itself.
  const onSettle = useCallback((id: string, on: boolean) => settle(col, id, on), [col]);
  const onSnooze = useCallback((id: string, at: Date | null) => snooze(col, id, at), [col]);

  return (
    <ThreadList
      active={typeof params.threadId === 'string' ? params.threadId : null}
      className={className}
      marks={marks}
      ready={rosterQuery.isReady}
      threads={rosterQuery.data}
      onSettle={onSettle}
      onSnooze={onSnooze}
    />
  );
}

type ThreadListProps = {
  active: string | null;
  className?: string;
  marks: ReadonlyMap<string, ThreadState>;
  ready: boolean;
  threads: Thread[];
  onSettle: (id: string, on: boolean) => void;
  onSnooze: (id: string, at: Date | null) => void;
};

/**
 * The list itself. Open threads are grouped by how recently they moved;
 * snoozed and settled ones wait in their own folded sections at its foot.
 */
function ThreadList({
  active,
  className,
  marks,
  ready,
  threads,
  onSettle,
  onSnooze,
}: ThreadListProps) {
  const nav = useNavigate();
  const field = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const now = useClock(threads);
  const search = useMemo(() => matcher(query), [query]);

  const shelves = useMemo(
    () => split(search.on ? threads.filter((thread) => search.hit(thread)) : threads, now),
    [now, search, threads],
  );

  const visible = shelves.open;
  const groups = useMemo(() => group(visible, now), [now, visible]);

  const [folds, setFolds] = useState({ snoozed: false, settled: false });

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

  function row(thread: Thread, where: Shelf) {
    return (
      <ThreadRow
        active={thread.id === active}
        id={thread.id}
        shelf={where}
        state={marks.get(thread.id)}
        match={search.on ? query.trim() : undefined}
        title={thread.title}
        updated={thread.updatedAt}
        wake={thread.snoozedUntil}
        onSettle={onSettle}
        onSnooze={onSnooze}
      />
    );
  }

  function show() {
    setOpen(true);
    field.current?.focus({ preventScroll: true });
  }

  function hide() {
    setOpen(false);
    setQuery('');
  }

  return (
    <section className={cn('grid min-h-0 grid-rows-[auto_1fr] gap-1', className)}>
      {/* The search lives in the section's own header. The field grows out of
          the search control, right to left, and the label steps aside as it
          comes — the list below never moves to make room for it. The reveal
          is a clip rather than a width, so it runs on the compositor. */}
      <header className="relative h-8">
        <h2
          aria-hidden={open}
          className={cn(
            'absolute inset-y-0 left-0 flex items-center px-2 text-[13px] text-muted-foreground',
            'transition-[opacity,translate] duration-[180ms] ease-out-strong motion-reduce:transition-none',
            open && 'pointer-events-none -translate-x-1 opacity-0',
          )}
        >
          Threads
        </h2>

        {/* On the column the thread states are drawn in, so every mark down the
            right side of the sidebar sits on one vertical line. Its glyph moves
            a pixel right: the lens, which is what the eye lines up with the
            round state marks, sits left of the icon's centre to make room for
            the handle. */}
        <Tip label="Search threads">
          <Button
            aria-expanded={open}
            aria-label="Search threads"
            className={cn(
              'absolute top-1 right-[9px] size-6 text-muted-foreground [&_svg]:translate-x-px',
              open && 'pointer-events-none opacity-0',
            )}
            size="icon-sm"
            tabIndex={open ? -1 : undefined}
            type="button"
            variant="ghost"
            onClick={show}
          >
            <MagnifyingGlassIcon weight="regular" />
          </Button>
        </Tip>

        <div
          className={cn(
            // Right edge on the rows' right edge, which the list's scroll
            // gutter keeps 4px inside the section.
            'absolute inset-y-0 right-1 left-0 flex items-center rounded-(--radius-control) bg-surface-3 shadow-surface-1',
            'transition-[clip-path,opacity] duration-[180ms] ease-out-strong motion-reduce:transition-none',
            open
              ? '[clip-path:inset(0_round_var(--radius-control))]'
              : 'pointer-events-none opacity-0 [clip-path:inset(0_0_0_calc(100%-2rem)_round_var(--radius-control))]',
          )}
        >
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center pl-2 text-muted-foreground"
          >
            <MagnifyingGlassIcon className="size-4" weight="regular" />
          </span>
          <label className="sr-only" htmlFor="thread-search">
            Search threads
          </label>
          <input
            ref={field}
            autoComplete="off"
            // The field has its own clear control; the browser's would sit
            // beside it as a second, heavier ×.
            className="ml-2 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
            id="thread-search"
            placeholder="Search threads"
            spellCheck={false}
            tabIndex={open ? undefined : -1}
            type="search"
            value={query}
            onBlur={() => {
              if (!query) setOpen(false);
            }}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                hide();
              }
            }}
          />
          <Button
            aria-label="Close search"
            className="mr-[5px] size-6 text-muted-foreground"
            size="icon-sm"
            tabIndex={open ? undefined : -1}
            type="button"
            variant="ghost"
            onClick={hide}
          >
            <XIcon weight="regular" />
          </Button>
        </div>
      </header>

      <ScrollArea
        className="-mx-1 min-h-0 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]"
        cueSize="tight"
        viewportClassName="px-1 pr-2 pb-8"
      >
        <nav aria-label="Conversations">
          {!ready ? (
            <Pending />
          ) : threads.length ? (
            <div className="grid">
              <Rows gap="gap-3">
                {groups.map((entry) => (
                  <Leaf id={entry.id} key={entry.id}>
                    <section aria-labelledby={`threads-${entry.id}`}>
                      {/* On the rows' own left edge, so the folder mark sits in
                          the same column as the nav icons above. */}
                      <div className="flex h-7 items-center gap-1.5 px-2">
                        <FolderSimpleIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                          weight="regular"
                        />
                        <h3
                          className="min-w-0 truncate text-[12.5px] text-muted-foreground"
                          id={`threads-${entry.id}`}
                        >
                          {entry.label}
                        </h3>
                        <Morph className="text-[12.5px] tabular-nums text-muted-foreground/60">
                          {entry.threads.length}
                        </Morph>
                      </div>

                      <Rows>
                        {entry.threads.map((thread, index) => (
                          <Leaf id={thread.id} index={index} key={thread.id}>
                            {row(thread, 'open')}
                          </Leaf>
                        ))}
                      </Rows>
                    </section>
                  </Leaf>
                ))}
              </Rows>

              {!visible.length ? (
                <Clear
                  filed={shelves.snoozed.length + shelves.settled.length > 0}
                  query={search.on ? query.trim() : null}
                  onClear={() => setQuery('')}
                />
              ) : null}

              {/* Folded away under the working list: out of the way, but one
                  press from coming back. A search opens them, since a match
                  hidden in a closed section is a match not found. */}
              <Rows>
                {shelves.snoozed.length ? (
                  <Leaf id="snoozed" key="snoozed">
                    <Fold
                      count={shelves.snoozed.length}
                      icon={MoonIcon}
                      id="snoozed"
                      label="Snoozed"
                      open={folds.snoozed || search.on}
                      onToggle={() => setFolds((fold) => ({ ...fold, snoozed: !fold.snoozed }))}
                    >
                      {shelves.snoozed.map((thread, index) => (
                        <Leaf id={thread.id} index={index} key={thread.id}>
                          {row(thread, 'snoozed')}
                        </Leaf>
                      ))}
                    </Fold>
                  </Leaf>
                ) : null}

                {shelves.settled.length ? (
                  <Leaf id="settled" key="settled">
                    <Fold
                      count={shelves.settled.length}
                      icon={SealCheckIcon}
                      id="settled"
                      label="Settled"
                      open={folds.settled || search.on}
                      onToggle={() => setFolds((fold) => ({ ...fold, settled: !fold.settled }))}
                    >
                      {shelves.settled.map((thread, index) => (
                        <Leaf id={thread.id} index={index} key={thread.id}>
                          {row(thread, 'settled')}
                        </Leaf>
                      ))}
                    </Fold>
                  </Leaf>
                ) : null}
              </Rows>
            </div>
          ) : (
            <Blank />
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
        <Skeleton className="h-12 rounded-(--radius-control) bg-surface-3/60" key={index} />
      ))}
    </div>
  );
}

/**
 * A list that animates what leaves it and what joins it. Rows already there
 * on first paint are simply there; only later changes move.
 */
function Rows({ children, gap = 'gap-px' }: { children: ReactNode; gap?: string }) {
  const fresh = useRef(true);

  useEffect(() => {
    fresh.current = false;
  }, []);

  return (
    <Fresh.Provider value={fresh}>
      <div className={cn('grid', gap)}>
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </div>
    </Fresh.Provider>
  );
}

/**
 * One entry in `Rows`. It folds its height away on the way out, so the rows
 * under it close up over the space rather than jumping into it, and unfolds
 * on the way in. The clip is only there while it moves: at rest a row's focus
 * ring and shadow reach past its box.
 *
 * Rows there on first paint arrive in the list's cascade instead, staggered by
 * `index`. A row that joins later skips it: a stagger is for a list arriving,
 * and on one row it is just a delay.
 */
function Leaf({ children, id, index = 0 }: { children: ReactNode; id: string; index?: number }) {
  const reduce = useReducedMotion();
  const fresh = useContext(Fresh);
  const [early] = useState(() => fresh.current);
  const gone = { height: 0, opacity: 0, overflow: 'hidden' };

  return (
    <motion.div
      animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
      data-leaf={id}
      exit={reduce ? { opacity: 0 } : { ...gone, transition: { duration: 0.18, ease: EASE } }}
      initial={reduce ? { opacity: 0 } : gone}
      transition={{ duration: 0.26, ease: EASE }}
    >
      {/* The cascade is a CSS animation, which would outrank the inline
          opacity the exit writes, so it runs one element in. */}
      <div className={early ? 'reveal' : undefined} style={{ ['--i' as string]: index }}>
        {children}
      </div>
    </motion.div>
  );
}

/**
 * A folded section at the foot of the list. The header is the whole toggle,
 * and its caret sits on the column the thread states are drawn in.
 */
function Fold(props: {
  children: ReactNode;
  count: number;
  icon: Icon;
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Mark = props.icon;
  const reduce = useReducedMotion();
  const box = useRef<HTMLElement>(null);
  const opened = useRef(props.open);

  // A fold opened at the foot of the list unrolls below the edge of the
  // sidebar, where nothing seems to have happened. Once it has room, the list
  // scrolls just far enough to bring it in.
  useEffect(() => {
    const was = opened.current;
    opened.current = props.open;
    if (!props.open || was) return;

    const timer = window.setTimeout(
      () => box.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }),
      reduce ? 0 : 200,
    );
    return () => window.clearTimeout(timer);
  }, [props.open, reduce]);

  return (
    <section ref={box} aria-labelledby={`threads-${props.id}`} className="scroll-mb-8 pt-3">
      <button
        aria-controls={`threads-${props.id}-list`}
        aria-expanded={props.open}
        className={cn(
          'group/fold flex h-7 w-full items-center gap-1.5 rounded-(--radius-control) px-2 text-left',
          'text-muted-foreground hover:bg-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        )}
        type="button"
        onClick={props.onToggle}
      >
        <Mark aria-hidden className="size-3.5 shrink-0 opacity-70" weight="regular" />
        <h3 className="min-w-0 truncate text-[12.5px]" id={`threads-${props.id}`}>
          {props.label}
        </h3>
        <Morph className="text-[12.5px] tabular-nums opacity-60">{props.count}</Morph>
        <CaretDownIcon
          aria-hidden
          className={cn(
            'mr-[3px] ml-auto size-3 shrink-0 opacity-70',
            'transition-[rotate] duration-(--t-base) ease-out-strong motion-reduce:transition-none',
            !props.open && '-rotate-90',
          )}
          weight="bold"
        />
      </button>

      <div className="t-grow" data-open={props.open} id={`threads-${props.id}-list`}>
        <div inert={!props.open}>
          <div className="pt-px">
            <Rows>{props.children}</Rows>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Why the open list is empty: a search that found nothing, a search whose
 * matches are all filed away below, or nothing left open at all.
 */
function Clear(props: { filed: boolean; query: string | null; onClear: () => void }) {
  const [title, body] =
    props.query === null
      ? ['All clear', 'Every thread is settled or snoozed.']
      : props.filed
        ? ['No open matches', `Only filed threads match “${props.query}”.`]
        : ['No matches', `Nothing matches “${props.query}”.`];

  return (
    <div className="px-2 py-3">
      <p className="text-[13px] text-foreground">{title}</p>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{body}</p>
      {props.query !== null && !props.filed ? (
        <Button
          className="mt-2.5 -ml-2 h-6 px-2 text-[12px]"
          size="sm"
          type="button"
          variant="secondary"
          onClick={props.onClear}
        >
          Clear search
        </Button>
      ) : null}
    </div>
  );
}

function Blank() {
  return (
    <div className="px-2 py-3">
      <p className="text-[13px] text-foreground">No threads yet</p>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
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

/**
 * Sort the threads onto their shelves. Open ones by when they last asked for
 * attention, snoozed ones by which wakes first, settled ones by which was put
 * away last.
 */
function split(threads: Thread[], now: number) {
  const on = (where: Shelf) => threads.filter((thread) => shelf(thread, now) === where);

  return {
    open: on('open').toSorted(
      (a, b) =>
        moved(b, now) - moved(a, now) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    ),
    snoozed: on('snoozed').toSorted(
      (a, b) => (a.snoozedUntil?.getTime() ?? 0) - (b.snoozedUntil?.getTime() ?? 0),
    ),
    settled: on('settled').toSorted(
      (a, b) => (b.settledAt?.getTime() ?? 0) - (a.settledAt?.getTime() ?? 0),
    ),
  };
}

/**
 * The time the list is drawn at. It moves on the minute, so "5m" stays true,
 * and exactly when the next snoozed thread is due, so it wakes on time rather
 * than up to a minute late.
 */
function useClock(threads: Thread[]) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const due = threads
      .map((thread) => thread.snoozedUntil?.getTime() ?? 0)
      .filter((at) => at > now);
    const next = Math.min(now + 60_000, ...due);
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(next - Date.now(), 0) + 20);
    return () => window.clearTimeout(timer);
  }, [now, threads]);

  return now;
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

function group(threads: Thread[], now: number) {
  const groups: ThreadGroup[] = [
    { id: 'today', label: 'Today', threads: [] },
    { id: 'recent', label: 'Recent', threads: [] },
    { id: 'older', label: 'Older', threads: [] },
  ];

  for (const thread of threads) {
    groups[bucket(new Date(moved(thread, now)))]?.threads.push(thread);
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

export { ThreadList, Threads };
