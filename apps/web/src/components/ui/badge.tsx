import type { ComponentProps } from 'react';

import { cn } from '~/lib/utils';

function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex items-center rounded-full border border-white/10 bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
