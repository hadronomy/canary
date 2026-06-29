import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentPropsWithRef, ComponentPropsWithoutRef, ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

type CommandProps = ComponentPropsWithoutRef<typeof CommandPrimitive>;

function Command({ className, ...props }: CommandProps) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

type CommandDialogProps = Omit<ComponentPropsWithoutRef<typeof Dialog>, 'children'> & {
  children: ReactNode;
  className?: string;
  description?: string;
  showCloseButton?: boolean;
  title?: string;
};

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          'overflow-visible rounded-xl! bg-transparent p-0 shadow-none ring-0 sm:max-w-none',
          className,
        )}
        motion={false}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

type CommandInputProps = ComponentPropsWithRef<typeof CommandPrimitive.Input> & {
  showIcon?: boolean;
  wrapperClassName?: string;
};

function CommandInput({
  className,
  ref,
  showIcon = true,
  wrapperClassName,
  ...props
}: CommandInputProps) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        'flex h-14 min-w-0 items-center gap-3 border-b border-border/65 bg-transparent px-4',
        wrapperClassName,
      )}
    >
      {showIcon ? (
        <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
      <CommandPrimitive.Input
        ref={ref}
        data-slot="command-input"
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-sm/relaxed text-foreground outline-hidden placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

type CommandListProps = ComponentPropsWithoutRef<typeof CommandPrimitive.List>;

function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none',
        className,
      )}
      {...props}
    />
  );
}

type CommandEmptyProps = ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>;

function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-6 text-center text-xs/relaxed', className)}
      {...props}
    />
  );
}

type CommandGroupProps = ComponentPropsWithoutRef<typeof CommandPrimitive.Group>;

function CommandGroup({ className, ...props }: CommandGroupProps) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

type CommandSeparatorProps = ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>;

function CommandSeparator({ className, ...props }: CommandSeparatorProps) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 my-1 h-px bg-border/50', className)}
      {...props}
    />
  );
}

type CommandItemProps = ComponentPropsWithRef<typeof CommandPrimitive.Item>;

function CommandItem({
  className,
  children,
  ref,
  ...props
}: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden select-none in-data-[slot=dialog-content]:rounded-md data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:text-foreground data-selected:ring-1 data-selected:ring-border/80 data-selected:*:[svg]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        surfaceState.dataSelected,
        className,
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

type CommandShortcutProps = ComponentPropsWithoutRef<'span'>;

function CommandShortcut({ className, ...props }: CommandShortcutProps) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        'ml-auto text-[0.625rem] tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
export type {
  CommandProps,
  CommandDialogProps,
  CommandInputProps,
  CommandListProps,
  CommandEmptyProps,
  CommandGroupProps,
  CommandSeparatorProps,
  CommandItemProps,
  CommandShortcutProps,
};
