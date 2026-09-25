import type { Lab } from '@canary/api/models';

import { labs } from '@canary/api/models';
import { cn } from '~/lib/utils';

/**
 * A lab's mark, bare: no tile behind it, sized by the caller.
 *
 * The paths are models.dev's logos, written into the catalog by the models
 * generator, so every mark is from one set — same weight, same optical size —
 * and drawn in `currentColor` to take the text colour around it.
 */
function Mark({ className, lab }: { className?: string; lab: Lab }) {
  const mark = labs[lab];

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
