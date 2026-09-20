import { Morph } from '~/lib/motion';
import { cn } from '~/lib/utils';

type SyncProps = {
  className?: string;
  ready: boolean;
  threads: number;
};

/**
 * Whether the local cache is caught up, and how much is in it.
 *
 * The old version of this said "Realtime sync" over a count, which names a
 * system rather than reporting a state — it read the same whether sync was
 * working or had never started. What a person wants to know is whether their
 * threads are here yet, so that is what it says.
 *
 * The count is the only number because it is the only real one. A progress bar
 * against an invented denominator looks like health reporting and tells nobody
 * anything.
 */
function Sync({ className, ready, threads }: SyncProps) {
  return (
    <div className={cn('flex items-center gap-2.5 px-2 py-1.5', className)}>
      <Dot ready={ready} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {ready ? 'Up to date' : 'Catching up'}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {ready ? (
            <>
              <Morph className="tabular-nums">{threads}</Morph>
              {threads === 1 ? ' thread on this device' : ' threads on this device'}
            </>
          ) : (
            'Fetching threads for this device'
          )}
        </span>
      </span>
    </div>
  );
}

/**
 * The state, as a mark rather than a word.
 *
 * Only the unsettled state animates. A dot that pulses forever is a decoration
 * that has stopped meaning anything — when this one moves, something is
 * actually happening.
 */
function Dot({ ready }: { ready: boolean }) {
  return (
    <span aria-hidden className="grid size-7 shrink-0 place-items-center">
      <span className="relative grid size-2 place-items-center">
        {ready ? null : (
          <span className="absolute size-2 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
        )}
        <span
          className={cn(
            'size-2 rounded-full transition-colors duration-(--t-base) ease-out-strong motion-reduce:transition-none',
            ready ? 'bg-success' : 'bg-primary',
          )}
        />
      </span>
    </span>
  );
}

/** The same state in one line, for the collapsed row. */
function summary(ready: boolean, threads: number) {
  if (!ready) {
    return 'Catching up…';
  }

  return threads === 1 ? '1 thread synced' : `${threads} threads synced`;
}

export { Sync, summary };
export type { SyncProps };
