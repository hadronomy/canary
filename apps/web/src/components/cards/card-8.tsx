import { Card } from '~/components/ui/card';
import { cn } from '~/lib/utils';

function Icon({ className }: { className: string }) {
  return <div className={cn('size-4 absolute border rounded-xs rotate-45 bg-card', className)} />;
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

export function Card_8({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <Card
      className={cn('relative rounded-none! shadow-none overflow-visible', className)}
      {...props}
    >
      <Icons />
      {children}
    </Card>
  );
}
