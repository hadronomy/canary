import type { ReactNode } from 'react';

import { Surface } from '~/components/ui/surface';
import { cn } from '~/lib/utils';

function MetricCard(props: {
  className?: string;
  detail?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <Surface className={cn('p-4', props.className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {props.label}
      </p>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{props.value}</div>
      {props.detail ? (
        <div className="mt-2 text-xs text-muted-foreground">{props.detail}</div>
      ) : null}
    </Surface>
  );
}

export { MetricCard };
