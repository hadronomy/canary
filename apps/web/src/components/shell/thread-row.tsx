import type { MouseEvent } from 'react';

import {
  CheckCircleIcon,
  CircleHalfIcon,
  CircleIcon,
  TrayArrowDownIcon as ArchiveIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';

import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/** What the thread's most recent run is doing, if it has had one. */
type ThreadState = 'running' | 'failed' | 'done' | 'idle';

type ThreadRowProps = {
  active: boolean;
  id: string;
  index?: number;
  onArchive: (id: string) => void;
  state?: ThreadState;
  title: string;
  updated: Date;
};

function ThreadRow({
  active,
  id,
  index = 0,
  onArchive,
  state = 'idle',
  title: label,
  updated,
}: ThreadRowProps) {
  const title = label.trim() || 'Untitled thread';

  function archive(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onArchive(id);
  }

  return (
    <div
      className={cn(
        'reveal group/item relative grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-(--radius-control) border',
        'transition-[background-color,border-color,box-shadow] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
        active
          ? 'border-input/50 bg-surface-3 shadow-surface-1'
          : 'border-transparent hover:bg-hover focus-within:bg-hover',
      )}
      style={{ ['--i' as string]: index }}
    >
      <Link
        aria-current={active ? 'page' : undefined}
        className="min-w-0 rounded-(--radius-control) px-2.5 py-2 outline-none"
        params={{ threadId: id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span
          className={cn(
            'block truncate text-sm leading-5',
            active ? 'text-foreground' : 'text-foreground/90',
          )}
        >
          {title}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <span className="shrink-0 font-mono tabular-nums">{id.slice(0, 8)}</span>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <time className="shrink-0 tabular-nums" dateTime={updated.toISOString()}>
            {when(updated)}
          </time>
        </span>
      </Link>

      {/* The status and the archive control share one slot. Status is what you
          want at rest; the control is what you want once the pointer is here,
          and stacking them keeps the title's width from changing on hover. */}
      <div className="relative grid size-8 shrink-0 place-items-center">
        <span
          aria-hidden
          className={cn(
            'col-start-1 row-start-1 transition-opacity duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
            'group-hover/item:opacity-0 group-focus-within/item:opacity-0',
          )}
        >
          <State state={state} />
        </span>

        <Button
          aria-label={`Archive ${title}`}
          className={cn(
            'col-start-1 row-start-1 size-6 text-muted-foreground opacity-0',
            'transition-[background-color,color,opacity] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
            'group-hover/item:opacity-100 focus-visible:opacity-100',
            'active:scale-[0.96]',
          )}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={archive}
        >
          <ArchiveIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function State({ state }: { state: ThreadState }) {
  if (state === 'running') {
    return <CircleHalfIcon className="size-3.5 text-chart-4" weight="fill" />;
  }

  if (state === 'failed') {
    return <WarningCircleIcon className="size-3.5 text-destructive" weight="fill" />;
  }

  if (state === 'done') {
    return <CheckCircleIcon className="size-3.5 text-success" weight="fill" />;
  }

  // A thread nothing has run on yet still gets a mark, so the column has a
  // consistent left edge and an empty slot never reads as a missing icon.
  return <CircleIcon className="size-3.5 text-muted-foreground/35" />;
}

function when(date: Date) {
  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'now';
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  if (sameDay(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(date, yesterday)) {
    return 'yesterday';
  }

  if (diff < 7 * 86_400_000) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export { ThreadRow };
export type { ThreadRowProps, ThreadState };
