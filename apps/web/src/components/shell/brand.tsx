import { LightningIcon } from '@phosphor-icons/react';

import { cn } from '~/lib/utils';

/**
 * The mark and the name.
 *
 * The mark stands on its own, in the same 20px column as the nav icons below
 * it, so the whole sidebar hangs off one vertical line. A mark set in a filled
 * tile is the stock logo lockup, and the tile was wider than every icon under
 * it, which pushed the name off the column the labels share.
 */
function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-8 min-w-0 items-center gap-2 px-2', className)}>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-foreground">
        <LightningIcon className="size-[18px]" weight="fill" />
      </span>
      <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">Canary</span>
    </div>
  );
}

export { Brand };
