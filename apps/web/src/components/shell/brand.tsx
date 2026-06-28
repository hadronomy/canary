import type { ComponentPropsWithoutRef } from 'react';

import { LightningIcon } from '@phosphor-icons/react';

import { cn } from '~/lib/utils';

type BrandProps = ComponentPropsWithoutRef<'div'> & {
  compact?: boolean;
};

function Brand({ className, compact = false, ...props }: BrandProps) {
  return (
    <div
      className={cn('flex h-10 min-w-0 items-center gap-3 overflow-hidden', className)}
      {...props}
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-[0.8rem] bg-foreground text-background ring-1 ring-line">
        <LightningIcon className="size-5" weight="fill" />
      </div>
      <div
        aria-hidden={compact}
        className={cn(
          'min-w-0 transition-[opacity,transform,filter] duration-150 ease-out-strong motion-reduce:transition-none',
          compact ? 'translate-x-1 opacity-0 blur-[1px]' : 'translate-x-0 opacity-100 blur-0',
        )}
      >
        <p className="truncate text-sm font-semibold">Canary</p>
        <p className="truncate text-[11px] text-muted-foreground">Agent workspace</p>
      </div>
    </div>
  );
}

export { Brand };
export type { BrandProps };
