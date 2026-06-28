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
import { InputGroup, InputGroupAddon } from '~/components/ui/input-group';
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
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0', className)}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

type CommandInputProps = ComponentPropsWithoutRef<typeof CommandPrimitive.Input>;

function CommandInput({ className, ...props }: CommandInputProps) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! bg-input/20 dark:bg-input/30">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            'w-full text-xs/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <MagnifyingGlassIcon className="size-3.5 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
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
        "group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden select-none in-data-[slot=dialog-content]:rounded-md data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground data-selected:*:[svg]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
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
