import { cn } from '~/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="skeleton" className={cn('shimmer rounded-md bg-muted', className)} {...props} />
  );
}

export { Skeleton };
