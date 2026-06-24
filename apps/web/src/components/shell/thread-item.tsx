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
  return (
    <div
      className={cn(
        'group grid grid-cols-[1fr_auto] items-center rounded-[var(--radius-control)] border border-transparent text-xs transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] hover:border-white/10 hover:bg-row',
        props.active && 'border-white/10 bg-row-active shadow-[inset_0_0_0_1px_oklch(1_0_0_/_4%)]',
      )}
    >
      <Link
        className="min-w-0 px-3 py-2.5"
        params={{ threadId: props.id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span className="block truncate text-sm font-medium text-foreground">{props.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {new Date(props.updated).toLocaleTimeString()}
        </span>
      </Link>
      <Button
        aria-label={`Archive ${props.title}`}
        className="mr-1 rounded-[var(--radius-press)] opacity-75 transition-opacity group-hover:opacity-100"
        size="icon-sm"
        type="button"
        variant="ghost"
        onClick={() => props.onArchive(props.id)}
      >
        <ArchiveIcon />
      </Button>
    </div>
  );
}

export { ThreadItem };
