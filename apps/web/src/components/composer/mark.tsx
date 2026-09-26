import type { Lab } from '@canary/api/models';

import { labs } from '@canary/api/models';
import { cn } from '~/lib/utils';

/**
 * A lab's mark, bare: no tile behind it, sized by the caller.
 *
 * The paths are models.dev's logos, written into the catalog by the models
 * generator, so every mark is from one set — same weight, same optical size —
 * and drawn in `currentColor` to take the text colour around it.
 *
 * A lab with no real logo gets its initial, set in the mark's box, rather than
 * a borrowed or invented shape standing in for one.
 */
function Mark({ className, lab }: { className?: string; lab: Lab }) {
  const mark = labs[lab].mark;

  if (!mark) {
    return (
      <span
        aria-hidden
        className={cn(
          'grid size-4 shrink-0 place-items-center text-[11px] leading-none font-semibold',
          className,
        )}
      >
        {labs[lab].name.charAt(0)}
      </span>
    );
  }

  return (
    <svg
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      fill="currentColor"
      viewBox={mark.box}
    >
      {mark.paths.map((path) => (
        <path
          key={path.d}
          clipRule={path.even ? 'evenodd' : undefined}
          d={path.d}
          fillRule={path.even ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  );
}

export { Mark };
