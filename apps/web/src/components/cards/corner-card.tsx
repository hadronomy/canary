import type { ComponentPropsWithoutRef } from 'react';

import { Card } from '~/components/ui/card';
import { cn } from '~/lib/utils';

function Icon({ className }: { className: string }) {
  return (
    <div
      className={cn('absolute size-4 rotate-45 rounded-xs border border-border bg-card', className)}
    />
  );
}

function Icons() {
  return (
    <>
      <Icon className="-top-2 -left-2" />
      <Icon className="-top-2 -right-2" />
      <Icon className="-bottom-2 -left-2" />
      <Icon className="-bottom-2 -right-2" />
    </>
  );
}

type CornerCardProps = ComponentPropsWithoutRef<typeof Card>;

function CornerCard({ className, children, ...props }: CornerCardProps) {
  return (
    <Card
      className={cn('relative overflow-visible rounded-lg shadow-surface-2', className)}
      {...props}
    >
      <Icons />
      {children}
    </Card>
  );
}

export { CornerCard };
export type { CornerCardProps };
