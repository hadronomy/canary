import { LightningIcon } from '~/components/icons';
import { cn } from '~/lib/utils';

function Brand(props: { compact?: boolean }) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-3 overflow-hidden">
      <div className="grid size-10 shrink-0 place-items-center rounded-[0.8rem] bg-foreground text-background ring-1 ring-line">
        <LightningIcon className="size-5" weight="fill" />
      </div>
      <div
        aria-hidden={props.compact}
        className={cn(
          'min-w-0 transition-[opacity,transform,filter] duration-150 ease-out-strong motion-reduce:transition-none',
          props.compact ? 'translate-x-1 opacity-0 blur-[1px]' : 'translate-x-0 opacity-100 blur-0',
        )}
      >
        <p className="truncate text-sm font-semibold">Canary</p>
        <p className="truncate text-[11px] text-muted-foreground">Agent workspace</p>
      </div>
    </div>
  );
}

export { Brand };
