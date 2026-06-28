import type { ComponentPropsWithRef } from 'react';

import { surfaceClasses } from '~/lib/surface-classes';
import { SurfaceProvider, useSurface } from '~/lib/surface-context';
import { cn } from '~/lib/utils';

type ElevatedProps = ComponentPropsWithRef<'div'> & {
  offset: number;
  shadowLevel?: number;
};

function Elevated({ className, offset, ref, shadowLevel, ...props }: ElevatedProps) {
  const base = useSurface();
  const level = Math.min(base + offset, 8);

  return (
    <SurfaceProvider value={level}>
      <div
        ref={ref}
        className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
        {...props}
      />
    </SurfaceProvider>
  );
}

export { Elevated };
export type { ElevatedProps };
