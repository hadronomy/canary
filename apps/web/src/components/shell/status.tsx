import type { ComponentPropsWithoutRef } from 'react';

import { PulseIcon } from '@phosphor-icons/react';

import { Progress } from '~/components/ui/progress';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

type SyncStatusProps = ComponentPropsWithoutRef<'div'> & {
  threads: number;
};

function SyncStatus({ className, threads, ...props }: SyncStatusProps) {
  const value = Math.min(100, 44 + threads * 4);

  return (
    <Elevated
      shadowLevel={1}
      className={cn(
        'min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-input/70 p-3',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-(--radius-press) border border-input/60 bg-background/35 text-primary">
          <PulseIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">Realtime sync</p>
          <p className="truncate text-[10px] text-muted-foreground">Electric local cache</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-foreground">{value}</p>
          <p className="text-[10px] text-muted-foreground">/100</p>
        </div>
      </div>
      <Progress className="mt-3 h-1 bg-input" value={value} />
    </Elevated>
  );
}

export { SyncStatus };
export type { SyncStatusProps };
