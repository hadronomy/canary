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
    <div className={cn('flex h-8 min-w-0 items-center gap-2 px-1', className)}>
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-[0.5rem] bg-foreground text-background"
      >
        <LightningIcon className="size-3.5" weight="fill" />
      </span>
      <span className="truncate text-[13px] font-medium tracking-[-0.01em]">Canary</span>
    </div>
  );
}

export { Brand };
