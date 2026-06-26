import type { MouseEvent } from 'react';

import { Link } from '@tanstack/react-router';

import { ArchiveIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

function ThreadItem(props: {
  active: boolean;
  id: string;
  onArchive: (id: string) => void;
  title: string;
  updated: string;
}) {
  const title = props.title.trim() || 'Untitled thread';

  function archive(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    props.onArchive(props.id);
  }

  return (
    <div
      className={cn(
        'group/item grid grid-cols-[minmax(0,1fr)_0rem] items-stretch overflow-hidden rounded-(--radius-control) border text-xs text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow,grid-template-columns] duration-150 ease-out-strong motion-reduce:transition-none',
        'hover:grid-cols-[minmax(0,1fr)_2.25rem] focus-within:grid-cols-[minmax(0,1fr)_2.25rem]',
        props.active
          ? 'border-line-strong bg-row text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--canary-foreground)_7%,transparent)]'
          : 'border-transparent hover:border-line hover:bg-row-hover hover:text-foreground focus-within:border-line focus-within:bg-row-hover focus-within:text-foreground',
      )}
    >
      <Link
        aria-current={props.active ? 'page' : undefined}
        aria-label={`${title}, updated ${formatThreadTime(props.updated)}, id ${props.id.slice(
          0,
          8,
        )}`}
        className="min-w-0 px-3 py-2 outline-none"
        params={{ threadId: props.id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span className="block truncate text-[13px] font-medium leading-5 text-foreground">
          {title}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <time className="shrink-0 tabular-nums" dateTime={props.updated}>
            {formatThreadTime(props.updated)}
          </time>

          <span aria-hidden="true" className="text-muted-foreground/45">
            ·
          </span>

          <span className="truncate font-mono text-[10px] tabular-nums">
            {props.id.slice(0, 8)}
          </span>
        </span>
      </Link>

      <div className="relative flex min-w-0 items-center justify-end overflow-hidden pr-1">
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-1 -left-5 w-5 bg-linear-to-r from-transparent opacity-0',
            'transition-opacity duration-150 ease-out-strong motion-reduce:transition-none',
            'group-hover/item:opacity-100',
            props.active ? 'to-row/95' : 'to-background/95 group-hover/item:to-row-hover/95',
          )}
        />

        <Button
          aria-label={`Archive ${title}`}
          className={cn(
            'pointer-events-none size-7 translate-x-1 scale-95 rounded-(--radius-press)',
            'border border-transparent bg-transparent text-muted-foreground opacity-0',
            'transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out-strong motion-reduce:translate-x-0 motion-reduce:scale-100 motion-reduce:transition-none',
            'hover:border-line hover:bg-surface-raised hover:text-foreground',
            'focus-visible:border-line-strong focus-visible:bg-surface-raised focus-visible:text-foreground',
            'group-hover/item:pointer-events-auto group-hover/item:translate-x-0 group-hover/item:scale-100 group-hover/item:opacity-100',
            'active:scale-[0.96]',
          )}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={archive}
        >
          <ArchiveIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function formatThreadTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (isSameLocalDay(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameLocalDay(date, yesterday)) {
    return 'yesterday';
  }

  if (diff < 7 * 86_400_000) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export { ThreadItem };
