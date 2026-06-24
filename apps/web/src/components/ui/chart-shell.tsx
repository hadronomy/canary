import type { ReactNode } from 'react';

import { Surface } from '~/components/ui/surface';
import { cn } from '~/lib/utils';

function ChartShell(props: { children: ReactNode; className?: string; title: string }) {
  return (
    <Surface className={cn('grid gap-4 p-4', props.className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <span className="size-2 rounded-full bg-success " />
      </div>
      <div className="min-h-48 rounded-2xl border border-line bg-surface/80">{props.children}</div>
    </Surface>
  );
}

export { ChartShell };
