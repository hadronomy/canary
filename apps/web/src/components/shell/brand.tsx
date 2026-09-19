import { LightningIcon } from '@phosphor-icons/react';

import { cn } from '~/lib/utils';

/**
 * The mark and the name.
 *
 * Set at the same weight and size as a nav row rather than as a header: the
 * sidebar has one job, and a logo shouting at the top of it is not part of it.
 */
function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-9 min-w-0 items-center gap-2 px-1', className)}>
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-[0.55rem] bg-foreground text-background"
      >
        <LightningIcon className="size-4" weight="fill" />
      </span>
      <span className="truncate text-sm font-medium tracking-[-0.01em]">Canary</span>
    </div>
  );
}

export { Brand };
