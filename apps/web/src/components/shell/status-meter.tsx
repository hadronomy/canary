import { PulseIcon } from '~/components/icons';
import { Progress } from '~/components/ui/progress';

function StatusMeter(props: { threads: number }) {
  const value = Math.min(100, 44 + props.threads * 4);

  return (
    <div className="min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-white/10 bg-[linear-gradient(145deg,oklch(1_0_0_/_5%),oklch(1_0_0_/_1%))] p-3 shadow-[inset_0_1px_0_oklch(1_0_0_/_7%)]">
      <div className="flex items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-press)] border border-white/10 bg-black/25 text-[--canary-success]">
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
      <Progress className="mt-3 h-1 bg-white/10" value={value} />
    </div>
  );
}

export { StatusMeter };
