import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { SidebarSimpleIcon } from '@phosphor-icons/react';

import { Brand } from '~/components/shell/brand';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet';
import { cn } from '~/lib/utils';

type MobileDrawerProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode;
};

function MobileDrawer({ children, className, ...props }: MobileDrawerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-(--radius-shell) border border-sidebar-border bg-sidebar px-2 py-1.5 shadow-surface-2 md:hidden',
        className,
      )}
      {...props}
    >
      <Brand />

      <Sheet>
        <SheetTrigger
          aria-label="Open workspace"
          render={
            <Button size="icon" type="button" variant="ghost">
              <SidebarSimpleIcon />
            </Button>
          }
        />
        <SheetContent className="p-2">
          <SheetTitle className="sr-only">Canary workspace</SheetTitle>
          <SheetDescription className="sr-only">
            Navigation, threads, and account controls.
          </SheetDescription>
          <div className="h-full min-h-0">{children}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { MobileDrawer };
export type { MobileDrawerProps };
