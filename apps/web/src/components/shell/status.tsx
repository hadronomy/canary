import type { ComponentPropsWithoutRef } from 'react';

import { PulseIcon } from '@phosphor-icons/react';

import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

type SyncStatusProps = ComponentPropsWithoutRef<'div'> & {
  state: 'syncing' | 'live' | 'retrying' | 'stopped';
  shape?: string;
  reason?: string;
};

const labels = {
  syncing: 'Syncing',
  live: 'Live',
  retrying: 'Retrying',
  stopped: 'Stopped',
};

const details = {
  syncing: 'Loading local data',
  live: 'Local data is current',
  retrying: 'Reconnecting to Electric',
  stopped: 'Sync needs attention',
};

function SyncStatus({ className, state, shape, reason, ...props }: SyncStatusProps) {
  const detail = reason ? `${shape ? `${shape}: ` : ''}${reason}` : details[state];

  return (
    <Elevated
      shadowLevel={1}
      className={cn(
        'min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-input/70 p-3',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3" role="status">
        <PulseIcon
          aria-hidden
          className={cn(
            'size-5 shrink-0',
            state === 'stopped' ? 'text-destructive' : 'text-primary',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">Realtime sync</p>
          <p className="truncate text-[10px] text-muted-foreground" title={detail}>
            {detail}
          </p>
        </div>
        <p className="text-xs font-medium text-foreground">{labels[state]}</p>
      </div>
    </Elevated>
  );
}

export { SyncStatus };
export type { SyncStatusProps };
