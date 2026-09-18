import { PulseIcon } from '@phosphor-icons/react';

import { Morph } from '~/lib/motion';
import { cn } from '~/lib/utils';

type SyncStatusProps = {
  className?: string;
  threads: number;
};

/**
 * What the local cache actually holds.
 *
 * The count is the only number here because it is the only one that is real —
 * a progress bar against an invented denominator looks like health reporting
 * and tells nobody anything.
 */
function SyncStatus({ className, threads }: SyncStatusProps) {
  return (
    <div className={cn('flex items-center gap-2.5 px-2 py-1.5', className)}>
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-(--radius-press) text-primary"
      >
        <PulseIcon className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">Realtime sync</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          <Morph className="tabular-nums">{threads}</Morph>
          {threads === 1 ? ' thread cached' : ' threads cached'}
        </span>
      </span>
    </div>
  );
}

export { SyncStatus };
export type { SyncStatusProps };
