import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '~/lib/utils';

function Progress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Track className="h-full w-full">
        <ProgressPrimitive.Indicator
          className="block h-full rounded-full bg-success transition-[width] duration-200 ease-out-strong"
          style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
