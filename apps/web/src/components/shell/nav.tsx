import { Link } from '@tanstack/react-router';

import type { ShellNavRoute } from '~/components/shell/routes';

import { primaryNav } from '~/components/shell/routes';
import { cn } from '~/lib/utils';

/**
 * The primary destinations, as labelled rows rather than an icon rail.
 *
 * Icons alone were costing a tooltip hover to read; at this width the label is
 * free and the row becomes a bigger, more forgiving target for the same cost.
 */
function Nav({ className }: { className?: string }) {
  return (
    <nav aria-label="Primary navigation" className={cn('grid content-start gap-0.5', className)}>
      {primaryNav.map((item) => (
        <NavLink item={item} key={item.to} />
      ))}
    </nav>
  );
}

function NavLink({ item }: { item: ShellNavRoute }) {
  const Icon = item.icon;

  return (
    <Link
      activeOptions={{ exact: item.nav.exact }}
      activeProps={{
        // The sidebar has no surface of its own, so the active row is the only
        // thing on it that is raised: one step up the ladder and the hairline
        // that comes with it.
        className: 'border-input/50 bg-surface-3 text-foreground shadow-surface-1',
      }}
      className={cn(
        'group flex h-9 items-center gap-2.5 rounded-(--radius-control) border border-transparent px-2.5',
        'text-sm text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
        'hover:bg-hover hover:text-foreground',
        'focus-visible:border-ring/50 focus-visible:bg-hover focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20',
      )}
      to={item.to}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export { Nav };
