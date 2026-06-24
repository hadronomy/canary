import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '~/lib/utils';

function Sheet(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetTitle(props: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="sheet-title" {...props} />;
}

function SheetDescription(props: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="sheet-description" {...props} />;
}

function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: 'left' | 'right';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed inset-y-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-sidebar p-2  outline-none data-closed:animate-out data-open:animate-in data-[side=left]:left-3 data-[side=left]:data-closed:slide-out-to-left-4 data-[side=left]:data-open:slide-in-from-left-4 data-[side=right]:right-3 data-[side=right]:data-closed:slide-out-to-right-4 data-[side=right]:data-open:slide-in-from-right-4',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
