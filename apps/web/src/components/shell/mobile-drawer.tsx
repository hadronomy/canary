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
        'flex items-center justify-between rounded-2xl border border-line bg-rail px-3 py-2 md:hidden',
        className,
      )}
      {...props}
    >
      <Brand />
      <Sheet>
        <SheetTrigger
          aria-label="Open workspace"
          render={
            <Button size="icon" type="button" variant="secondary">
              <SidebarSimpleIcon />
            </Button>
          }
        />
        <SheetContent>
          <SheetTitle className="sr-only">Canary workspace</SheetTitle>
          <SheetDescription className="sr-only">
            Navigation, threads, and account controls.
          </SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { MobileDrawer };
export type { MobileDrawerProps };
