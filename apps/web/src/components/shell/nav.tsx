import { Link } from '@tanstack/react-router';

import type { ShellNavRoute } from '~/components/shell/routes';

import { primaryNav } from '~/components/shell/routes';
import { surfaceState } from '~/lib/surface-classes';
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
        // The active row is a surface, not a highlight: one step up the ladder
        // plus the hairline that comes with it, so it reads as raised rather
        // than as coloured-in.
        className: 'border-input/60 bg-surface-3 text-foreground shadow-surface-1',
      }}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-(--radius-control) border border-transparent px-2',
        'text-[13px] font-medium text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
        surfaceState.hover,
        surfaceState.focus,
        'focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20',
      )}
      to={item.to}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export { Nav };
