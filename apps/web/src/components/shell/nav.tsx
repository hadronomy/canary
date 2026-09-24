import { Link } from '@tanstack/react-router';

import type { ShellNavRoute } from '~/components/shell/routes';

import { primaryNav } from '~/components/shell/routes';
import { cn } from '~/lib/utils';

/**
 * The primary destinations, as labelled rows rather than an icon rail.
 *
 * Icons alone were costing a tooltip hover to read; at this width the label is
 * free and the row becomes a bigger, more forgiving target for the same cost.
 *
 * Rows are 32px with a 16px line icon in a 20px slot, the brand's slot, so
 * every icon and every label in the sidebar shares one left edge. The icons are
 * drawn at the regular weight rather than the app's duotone: at this size the
 * duotone fill turns to a smudge inside the outline.
 */
function Nav({ className }: { className?: string }) {
  return (
    <nav aria-label="Primary navigation" className={cn('grid content-start gap-px', className)}>
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
        'flex h-8 items-center gap-2 rounded-(--radius-control) border border-transparent px-2',
        'text-[13.5px] text-muted-foreground',
        // Hover switches on at once: a pointer on its way down the sidebar
        // crosses every row, and a fade on each one trails behind it.
        'hover:bg-hover hover:text-foreground',
        'transition-[scale] duration-(--t-press) ease-out-strong active:scale-[0.98] motion-reduce:transition-none',
        'focus-visible:border-ring/50 focus-visible:bg-hover focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20',
      )}
      to={item.to}
    >
      <span aria-hidden className="grid size-5 shrink-0 place-items-center">
        <Icon className="size-4" weight="regular" />
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export { Nav };
