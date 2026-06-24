import type { ReactNode } from 'react';

import { SidebarSimpleIcon } from '~/components/icons';
import { Brand } from '~/components/shell/brand';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet';

function MobileSidebar(props: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-line bg-rail px-3 py-2 md:hidden">
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
          {props.children}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { MobileSidebar };
