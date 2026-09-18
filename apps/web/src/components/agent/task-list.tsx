import type { ReactNode } from 'react';

import {
  CircleNotchIcon,
  FileTextIcon,
  FolderSimpleIcon,
  TerminalWindowIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Check } from '~/lib/motion';
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
   * Fold finished tasks away. `true` collapses each one as it completes;
   * `'all'` waits until every task is done and closes them together.
   */
  collapseOnComplete?: boolean | 'all';
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
 * Tasks arrive one at a time, each opening its own height out of a short blur
 * and lift, so the thread grows the way the work does instead of jumping to its
 * final size. A running task shimmers; a finished one settles and stops.
 *
 * Every row is in the DOM from the start and is only clipped, so a reveal that
 * never fires costs a person nothing — the log is readable either way.
 */
function TaskList({
  className,
  collapseOnComplete = false,
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
  const finished = tasks.every((task) => task.status === 'done' || task.status === 'failed');

  return (
    <ol className={cn('grid gap-px', className)}>
      {tasks.map((task, index) => {
        const open = index < shown;
        const folded =
          collapseOnComplete === 'all'
            ? finished
            : collapseOnComplete && (task.status === 'done' || task.status === 'failed');

        return (
          <li key={task.id} className="t-grow" data-open={open && !folded}>
            <div>
              <Row task={task} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ task }: { task: Task }) {
  const running = task.status === 'running';

  const head = (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-(--radius-control) px-2 py-1.5',
        task.detail && 'cursor-pointer list-none',
      )}
    >
      <span className="mt-px grid size-4 shrink-0 place-items-center">
        <Status status={task.status} />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[13px] leading-5',
            running
              ? 'shimmer-text'
              : task.status === 'pending'
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {task.label}
        </span>

        {task.resources?.length ? (
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            {task.resources.map((resource) => (
              <Chip key={resource.name} resource={resource} />
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );

  if (!task.detail) {
    return head;
  }

  return (
    <details className="min-w-0 [&[open]_summary]:text-foreground">
      <summary className="list-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        {head}
      </summary>
      <pre className="m-0 mx-2 mb-1.5 max-h-72 max-w-full overflow-auto whitespace-pre-wrap rounded-(--radius-press) bg-surface-2 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground wrap-anywhere">
        {task.detail}
      </pre>
    </details>
  );
}

function Status({ status }: { status: TaskStatus }) {
  if (status === 'running') {
    return <CircleNotchIcon className="size-3.5 animate-spin text-primary" />;
  }

  if (status === 'done') {
    return <Check className="size-3.5 text-primary" />;
  }

  if (status === 'failed') {
    return <WarningIcon className="size-3.5 text-destructive" />;
  }

  // Pending is a ring rather than an empty box: something is queued here, and a
  // blank slot reads as a rendering mistake.
  return <span className="size-2 rounded-full border border-muted-foreground/50" />;
}

function Chip({ resource }: { resource: Resource }) {
  const Icon =
    resource.kind === 'dir'
      ? FolderSimpleIcon
      : resource.kind === 'command'
        ? TerminalWindowIcon
        : FileTextIcon;

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-(--radius-press) bg-surface-4/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
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
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-(--radius-panel) border border-border bg-surface-3/60 p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

export { TaskGroup, TaskList };
export type { Task, TaskListProps, TaskStatus };
