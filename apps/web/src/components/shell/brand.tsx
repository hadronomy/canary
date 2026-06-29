import type { ComponentPropsWithoutRef } from 'react';

import { LightningIcon } from '@phosphor-icons/react';

import { cn } from '~/lib/utils';

type BrandProps = ComponentPropsWithoutRef<'div'> & {
  compact?: boolean;
};

function Brand({ className, compact = false, ...props }: BrandProps) {
  if (compact) {
    return (
      <div
        aria-label="Canary"
        className={cn('grid size-10 place-items-center overflow-hidden', className)}
        role="img"
        {...props}
      >
        <Mark />
      </div>
    );
  }

  return (
    <div
      className={cn('flex h-10 min-w-0 items-center gap-3 overflow-hidden', className)}
      {...props}
    >
      <Mark />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">Canary</p>
        <p className="truncate text-[11px] text-muted-foreground">Agent workspace</p>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-[0.8rem] bg-foreground text-background ring-1 ring-line">
      <LightningIcon className="size-5" weight="fill" />
    </div>
  );
}

export { Brand };
export type { BrandProps };
