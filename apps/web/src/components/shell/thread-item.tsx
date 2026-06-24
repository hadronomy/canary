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
        'group grid grid-cols-[1fr_auto] items-center rounded-(--radius-control) border border-transparent text-xs text-muted-foreground',
        'transition-[background-color,border-color,color] duration-150 ease-out-strong',
        'hover:border-line hover:bg-row-hover hover:text-foreground',
        props.active && 'border-line bg-row text-foreground hover:border-line-strong hover:bg-row',
      )}
    >
      <Link
        aria-current={props.active ? 'page' : undefined}
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
        className={cn(
          'mr-1 rounded-(--radius-press) text-muted-foreground opacity-60',
          'transition-[background-color,color,opacity] duration-150 ease-out-strong',
          'hover:bg-row-hover hover:text-foreground group-hover:opacity-100',
          props.active && 'opacity-80',
        )}
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
