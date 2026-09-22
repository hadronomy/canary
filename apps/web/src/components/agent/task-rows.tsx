import type { ReactNode } from 'react';

import { useState } from 'react';

import { cn } from '~/lib/utils';

/**
 * A plan, as capsules that open in place.
 *
 * Based on `@beautifului/task-rows`. The registry version is a demo driven by
 * a scripted timeline — rows flip to failed and back on a stopwatch. That is
 * the right shape for a gallery tile and the wrong one for a product, so the
 * timeline is gone and every state here comes from the data.
 *
 * What is kept is the grammar: the capsule flattens as it opens, the badge
 * lands rather than appears, and the detail lines sit against a guide that ties
 * them to the row that produced them.
 */

type TaskState = 'pending' | 'running' | 'done' | 'failed';

/** One line under an open row: what happened, and the number that proves it. */
type TaskDetail = {
  label: string;
  meta?: string;
};

type TaskRow = {
  /** Shown flush right in the row, before the status pill. A count, a size, a
   *  duration — the number a person scans for without opening anything. */
  amount?: string;
  details?: readonly TaskDetail[];
  id: string;
  label: string;
  /** The position shown inside the ring while pending or running. Defaults to
   *  the row's index, which is right unless the caller is paging. */
  step?: number;
  status: TaskState;
};

type TaskRowsProps = {
  className?: string;
  /** `capsules` floats each row as its own object; `list` collapses them into
   *  one card with dividers, for when the plan is long enough that six
   *  shadows becomes noise. */
  variant?: 'capsules' | 'list';
  onToggle?: (id: string, open: boolean) => void;
  rows: readonly TaskRow[];
};

function TaskRows({ className, onToggle, rows, variant = 'capsules' }: TaskRowsProps) {
  const list = variant === 'list';

  return (
    <ol
      className={cn(
        'flex min-w-0 flex-col',
        list ? 'overflow-hidden rounded-(--radius-panel) bg-surface-3 shadow-surface-2' : 'gap-1.5',
        className,
      )}
    >
      {rows.map((row, index) => (
        <Row key={row.id} index={index} list={list} row={row} onToggle={onToggle} />
      ))}
    </ol>
  );
}

function Row({
  index,
  list,
  onToggle,
  row,
}: {
  index: number;
  list: boolean;
  onToggle?: (id: string, open: boolean) => void;
  row: TaskRow;
}) {
  // A failure opens itself. Everything else waits to be asked for — but a step
  // that failed is the reason the plan is being read at all.
  const [open, setOpen] = useState(row.status === 'failed');
  const body = row.details?.length ? row.details : null;
  const shown = open && !!body;

  return (
    <li
      className={cn(
        'reveal group/row min-w-0 overflow-hidden',
        // Radius is the state: round at rest, flattened once something hangs
        // off the bottom. A pill that stays a pill with a body under it reads
        // as two objects rather than one that grew.
        'transition-[border-radius,background-color] duration-(--t-base) ease-out-strong motion-reduce:transition-none',
        list
          ? 'border-b border-border last:border-0'
          : cn(
              'bg-surface-3 shadow-surface-2',
              shown ? 'rounded-(--radius-panel)' : 'rounded-full',
            ),
      )}
      style={{ ['--i' as string]: index }}
    >
      <button
        aria-expanded={body ? shown : undefined}
        className={cn(
          'flex h-11 w-full min-w-0 items-center gap-2.5 px-2.5 text-left',
          'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset',
          body ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
        )}
        disabled={!body}
        type="button"
        onClick={() => {
          setOpen(!open);
          onToggle?.(row.id, !open);
        }}
      >
        <Status state={row.status} step={row.step ?? index + 1} />

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-medium leading-5',
            row.status === 'running'
              ? 'shimmer-text'
              : row.status === 'pending'
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {row.label}
        </span>

        {row.amount ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
            {row.amount}
          </span>
        ) : null}

        {row.status === 'done' ? <Pill tone="success">Completed</Pill> : null}
        {row.status === 'failed' ? <Pill tone="destructive">Failed</Pill> : null}

        {/* Pulled back into the row's own padding so the caret sits on the
            optical edge rather than a hit-target's worth inside it. */}
        <Caret hidden={!body} open={shown} />
      </button>

      <div className="t-grow" data-open={shown}>
        <div>
          <div className="mb-2.5 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 px-2.5">
            <span aria-hidden className="mx-auto h-full w-px bg-border" />

            <dl className="flex min-w-0 flex-col gap-1.5">
              {body?.map((detail) => (
                <div
                  key={detail.label}
                  className="flex min-w-0 items-baseline justify-between gap-3"
                >
                  <dt className="min-w-0 truncate text-xs text-muted-foreground">{detail.label}</dt>
                  {detail.meta ? (
                    <dd className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground/60">
                      {detail.meta}
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The step's state, in a fixed slot so every label shares a left edge.
 *
 * Pending and running both carry the step's own number. In a plan of nine, a
 * bare spinner cannot say which one is turning, and an empty ring reads as
 * something that failed to render rather than something waiting its turn.
 */
function Status({ state, step }: { state: TaskState; step: number }) {
  if (state === 'done') {
    return (
      <Badge tone="success">
        <svg
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
          viewBox="0 0 24 24"
          width="13"
          height="13"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </Badge>
    );
  }

  if (state === 'failed') {
    return (
      <Badge tone="destructive">
        <svg
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3.5"
          viewBox="0 0 24 24"
          width="12"
          height="12"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </Badge>
    );
  }

  return <Ring running={state === 'running'}>{step}</Ring>;
}

/**
 * A number inside a track, with an arc over it while the step is live.
 *
 * The arc is a little over a quarter of the circumference: long enough to read
 * as rotation at 24px, short enough that it never reads as a progress value it
 * does not have.
 */
function Ring({ children, running }: { children: ReactNode; running: boolean }) {
  const r = 11;
  const c = 2 * Math.PI * r;

  return (
    <span aria-hidden className="relative grid size-6 shrink-0 place-items-center">
      <svg
        className={cn('absolute inset-0', running && 'animate-spin motion-reduce:animate-none')}
        height="24"
        width="24"
      >
        <circle cx="12" cy="12" fill="none" r={r} stroke="var(--border)" strokeWidth="2" />
        {running ? (
          <circle
            cx="12"
            cy="12"
            fill="none"
            r={r}
            stroke="var(--primary)"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
            strokeLinecap="round"
            strokeWidth="2"
          />
        ) : null}
      </svg>

      <span
        className={cn(
          'relative text-[10.5px] font-semibold tabular-nums',
          running ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
      </span>
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'success' | 'destructive' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pop grid size-6 shrink-0 place-items-center rounded-full text-background',
        tone === 'success' ? 'bg-success' : 'bg-destructive',
      )}
    >
      {children}
    </span>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: 'success' | 'destructive' }) {
  return (
    <span
      className={cn(
        'pop inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium',
        tone === 'success' ? 'bg-success/12 text-success' : 'bg-destructive/12 text-destructive',
      )}
    >
      {children}
    </span>
  );
}

function Caret({ hidden, open }: { hidden: boolean; open: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        '-mr-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground/60',
        'transition-opacity duration-(--t-fast) motion-reduce:transition-none',
        hidden && 'opacity-0',
      )}
    >
      <svg
        className={cn(
          'transition-transform duration-(--t-base) ease-out-strong motion-reduce:transition-none',
          open && 'rotate-180',
        )}
        fill="none"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        viewBox="0 0 24 24"
        width="15"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

export { TaskRows };
export type { TaskDetail, TaskRow, TaskRowsProps, TaskState };
