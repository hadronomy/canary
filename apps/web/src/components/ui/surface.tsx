import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '~/lib/utils';

type SurfaceProps = ComponentPropsWithoutRef<'section'>;

function Surface({ className, ...props }: SurfaceProps) {
  return (
    <section
      className={cn('rounded-lg border border-border bg-card shadow-surface-2', className)}
      {...props}
    />
  );
}

export { Surface };
export type { SurfaceProps };
