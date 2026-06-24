import { PulseIcon } from '~/components/icons';
import { Progress } from '~/components/ui/progress';

function StatusMeter(props: { threads: number }) {
  const value = Math.min(100, 44 + props.threads * 4);

  return (
    <div className="min-w-0 overflow-hidden rounded-[calc(var(--radius-shell)-0.375rem)] border border-line bg-surface-raised p-3 ">
      <div className="flex items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-(--radius-press) border border-line bg-surface/85 text-success">
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
      <Progress className="mt-3 h-1 bg-line-strong" value={value} />
    </div>
  );
}

export { StatusMeter };
