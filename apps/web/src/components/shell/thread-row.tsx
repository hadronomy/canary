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

/**
 * One thread: what it is about on the first line, and on the second the short
 * id and how long ago it moved.
 *
 * Two lines, because the second one is what tells two similar titles apart and
 * what makes the list scannable by recency without opening anything. The state
 * of the last run sits on the title's line, where the eye already is when it
 * reads the name.
 */
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
        'reveal group/item relative grid grid-cols-[minmax(0,1fr)_auto] rounded-(--radius-control) border',
        // Hover switches on at once; the row is crossed on the way down the
        // list far more often than it is opened.
        active
          ? 'border-input/50 bg-surface-3 shadow-surface-1'
          : 'border-transparent hover:bg-hover focus-within:bg-hover',
      )}
      style={{ ['--i' as string]: index }}
    >
      <Link
        aria-current={active ? 'page' : undefined}
        className="min-w-0 rounded-(--radius-control) py-1.5 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        params={{ threadId: id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span
          className={cn(
            'block truncate text-[13.5px] leading-5',
            active ? 'text-foreground' : 'text-foreground/85',
          )}
        >
          {title}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-muted-foreground">
          <span className="shrink-0 font-mono tabular-nums">{id.slice(0, 8)}</span>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <time className="shrink-0 tabular-nums" dateTime={updated.toISOString()}>
            {when(updated)}
          </time>
        </span>
      </Link>

      {/* The state and the archive control share one slot, level with the
          title. State is what you want at rest, the control once the pointer
          is here; stacked in one cell and swapped with no fade, the title's
          width never changes under the pointer. */}
      <div className="grid h-8 w-8 place-items-center">
        <span
          aria-hidden
          className="col-start-1 row-start-1 group-hover/item:invisible group-focus-within/item:invisible"
        >
          <State state={state} />
        </span>

        <Button
          aria-label={`Archive ${title}`}
          className={cn(
            'invisible col-start-1 row-start-1 size-6 text-muted-foreground',
            'group-hover/item:visible group-focus-within/item:visible',
            'active:scale-[0.94]',
          )}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={archive}
        >
          <ArchiveIcon className="size-3.5" weight="regular" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The last run, as a filled mark. Filled rather than outlined so each state
 * reads as a colour at a glance down the column; an unstarted thread keeps a
 * faint ring, so the column has one edge and an empty slot never reads as a
 * missing icon.
 */
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

  return <CircleIcon className="size-3.5 text-muted-foreground/40" weight="regular" />;
}

/**
 * How long ago, in the fewest characters that still read at a glance: minutes,
 * then hours, then a weekday, then a date.
 */
function when(date: Date) {
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'now';
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  if (hours < 24 * 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

export { ThreadRow };
export type { ThreadRowProps, ThreadState };
