import type { MouseEvent } from 'react';

import { TrayArrowDownIcon as ArchiveIcon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';

import { Button } from '~/components/ui/button';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

type ThreadRowProps = {
  active: boolean;
  id: string;
  index?: number;
  onArchive: (id: string) => void;
  title: string;
  updated: Date;
};

function ThreadRow({ active, id, index = 0, onArchive, title: label, updated }: ThreadRowProps) {
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
          ? 'border-input/60 bg-surface-3 shadow-surface-1'
          : cn('border-transparent', surfaceState.hover, surfaceState.focusWithin),
      )}
      style={{ ['--i' as string]: index }}
    >
      <Link
        aria-current={active ? 'page' : undefined}
        className="min-w-0 rounded-(--radius-control) px-2 py-1.5 outline-none"
        params={{ threadId: id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span
          className={cn(
            'block truncate text-[13px] leading-5',
            active ? 'font-medium text-foreground' : 'text-foreground/90',
          )}
        >
          {title}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <time className="shrink-0 tabular-nums" dateTime={updated.toISOString()}>
            {when(updated)}
          </time>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="truncate font-mono text-[10px] tabular-nums">{id.slice(0, 8)}</span>
        </span>
      </Link>

      {/* Held out of the layout so the title keeps the full row width until the
          pointer is actually here. It fades and slides rather than popping,
          because a control appearing under a moving cursor reads as a misclick
          waiting to happen. */}
      <div className="pr-1">
        <Button
          aria-label={`Archive ${title}`}
          className={cn(
            'size-6 translate-x-1 text-muted-foreground opacity-0',
            'transition-[background-color,color,opacity,transform] duration-(--t-fast) ease-out-strong',
            'motion-reduce:translate-x-0 motion-reduce:transition-none',
            'group-hover/item:translate-x-0 group-hover/item:opacity-100',
            'focus-visible:translate-x-0 focus-visible:opacity-100',
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
export type { ThreadRowProps };
