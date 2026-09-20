import type { ReactNode } from 'react';

import {
  CaretDownIcon,
  FileTextIcon,
  FolderSimpleIcon,
  TerminalWindowIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { cn } from '~/lib/utils';

type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

type Resource = {
  /** Shown as the chip label. Long names truncate rather than wrapping the row. */
  name: string;
  kind?: 'file' | 'dir' | 'command';
};

type Task = {
  /**
   * What the step actually produced, when there is something worth reading.
   * The log answers "what happened"; this is the only way to answer "and what
   * did it say", and dropping it would cost people the tool output entirely.
   */
  detail?: string;
  id: string;
  label: string;
  status: TaskStatus;
  resources?: readonly Resource[];
};

type TaskListProps = {
  className?: string;
  /**
   * How many tasks are allowed to be on screen, when the caller is driving the
   * reveal from a real event stream. Leave it off and the list paces itself
   * from `startDelay` and `stepInterval` instead.
   */
  revealed?: number;
  /** Delay before the first reveal, so the log does not land on the same frame
   *  as the turn that caused it. */
  startDelay?: number;
  /** Pace of every reveal after the first. */
  stepInterval?: number;
  tasks: readonly Task[];
};

/**
 * A streaming log of what an agent actually did.
 *
 * Each step is a capsule that opens in place. The row is a button rather than
 * a `<summary>` because a `<details>` cannot animate its own height — it snaps
 * — and the snap is worst exactly where it matters, on a failure whose output
 * runs to twenty lines. Opening is a grid row going `0fr` to `1fr`, which gets
 * the height animation without anyone measuring anything.
 *
 * The capsule flattens as it opens: 999px at rest, the panel radius once there
 * is a body under the row. A pill that stays a pill while a block of output
 * hangs off it reads as two separate objects.
 *
 * Every row is in the DOM from the start and is only clipped, so a reveal that
 * never fires costs a person nothing — the log is readable either way.
 */
function TaskList({
  className,
  revealed,
  startDelay = 260,
  stepInterval = 420,
  tasks,
}: TaskListProps) {
  const paced = usePacing({
    count: tasks.length,
    enabled: revealed === undefined,
    startDelay,
    stepInterval,
  });

  const shown = revealed ?? paced;

  return (
    <ol className={cn('grid gap-1', className)}>
      {tasks.map((task, index) => (
        <li key={task.id} className="t-grow" data-open={index < shown}>
          <div>
            <Row index={index} task={task} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Row({ index, task }: { index: number; task: Task }) {
  // A failure opens itself. Everything else is there to be asked for, but a
  // step that failed is the reason the log is being read at all.
  const [open, setOpen] = useState(task.status === 'failed');
  const failed = task.status === 'failed';
  const body = task.detail;

  return (
    <div
      className={cn(
        'reveal overflow-hidden border',
        'transition-[background-color,border-color,border-radius] duration-(--t-base) ease-out-strong motion-reduce:transition-none',
        open ? 'rounded-(--radius-panel)' : 'rounded-full',
        failed
          ? 'border-destructive/25 bg-destructive/8'
          : 'border-transparent bg-surface-3/70 hover:border-input/40',
      )}
      style={{ ['--i' as string]: index }}
    >
      <button
        aria-expanded={body ? open : undefined}
        className={cn(
          'flex h-9 w-full min-w-0 items-center gap-2.5 px-2.5 text-left',
          'transition-colors duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
          body ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        )}
        disabled={!body}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <Status index={index} status={task.status} />

        <span
          className={cn(
            'min-w-0 truncate text-[13px] leading-5',
            task.status === 'running'
              ? 'shimmer-text'
              : task.status === 'pending'
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {task.label}
        </span>

        {task.resources?.length ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {task.resources.map((resource) => (
              <Chip key={resource.name} resource={resource} />
            ))}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {failed ? <Pill>Failed</Pill> : null}

        {body ? (
          <CaretDownIcon
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/60',
              'transition-transform duration-(--t-base) ease-out-strong motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {/* `0fr` to `1fr` is the height animation, without measuring anything.
          The guide column keeps the output tied to the row that produced it
          rather than floating loose under the capsule. */}
      <div className="t-grow" data-open={open && !!body}>
        <div>
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 px-2.5 pb-2.5">
            <span aria-hidden className="mx-auto w-px bg-border" />
            <pre
              className={cn(
                'm-0 max-h-72 max-w-full overflow-auto whitespace-pre-wrap rounded-(--radius-press)',
                'px-2.5 py-2 font-mono text-[11px] leading-5 wrap-anywhere',
                failed
                  ? 'bg-destructive/10 text-destructive/90'
                  : 'bg-surface-2 text-muted-foreground',
              )}
            >
              {body}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The step's state, in a fixed slot so the labels share a left edge.
 *
 * A running step shows its own number inside the ring rather than a bare
 * spinner: in a log of nine steps, which one is turning is the thing you want
 * to know, and a spinner alone cannot say it.
 */
function Status({ index, status }: { index: number; status: TaskStatus }) {
  if (status === 'running') {
    return (
      <span className="relative grid size-5 shrink-0 place-items-center">
        <svg
          aria-hidden
          className="absolute inset-0 size-5 animate-spin motion-reduce:animate-none"
          viewBox="0 0 20 20"
        >
          <circle cx="10" cy="10" r="9" fill="none" stroke="var(--border)" strokeWidth="1.5" />
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke="var(--primary)"
            strokeDasharray="16 41"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
        <span className="relative text-[9px] font-semibold tabular-nums text-foreground">
          {index + 1}
        </span>
      </span>
    );
  }

  if (status === 'done') {
    return (
      <Badge tone="success">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </Badge>
    );
  }

  if (status === 'failed') {
    return (
      <Badge tone="destructive">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </Badge>
    );
  }

  // Pending is a ring with its number, not an empty box: something is queued
  // here, and a blank slot reads as a rendering mistake.
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full border border-muted-foreground/30">
      <span className="text-[9px] font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'success' | 'destructive' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pop grid size-5 shrink-0 place-items-center rounded-full text-background',
        tone === 'success' ? 'bg-success' : 'bg-destructive',
      )}
    >
      {children}
    </span>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-destructive/15 px-2 text-[11px] font-medium text-destructive">
      {children}
    </span>
  );
}

function Chip({ resource }: { resource: Resource }) {
  const Icon =
    resource.kind === 'dir'
      ? FolderSimpleIcon
      : resource.kind === 'command'
        ? TerminalWindowIcon
        : FileTextIcon;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-surface-5/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate font-mono">{resource.name}</span>
    </span>
  );
}

/**
 * Reveal one task at a time on a timer.
 *
 * Only used when the caller has no real progress to drive from. A run that
 * reports its own steps should pass `revealed` and let the log follow the work
 * rather than a stopwatch.
 */
function usePacing(input: {
  count: number;
  enabled: boolean;
  startDelay: number;
  stepInterval: number;
}) {
  const [shown, setShown] = useState(input.enabled ? 0 : input.count);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(input.count);
      return;
    }

    setShown(0);

    let step = 0;
    let timer = 0;

    function next() {
      step += 1;
      setShown(step);

      if (step < input.count) {
        timer = window.setTimeout(next, input.stepInterval);
      }
    }

    timer = window.setTimeout(next, input.startDelay);

    return () => clearTimeout(timer);
  }, [input.count, input.enabled, input.startDelay, input.stepInterval]);

  return shown;
}

function TaskGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0', className)}>{children}</div>;
}

export { TaskGroup, TaskList };
export type { Task, TaskListProps, TaskStatus };
