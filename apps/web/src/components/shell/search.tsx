import type { ComponentPropsWithoutRef } from 'react';

import { CommandIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

const key =
  'size-6 min-w-6 rounded-[0.6rem] border border-line bg-control p-0 text-[13px] font-medium text-foreground/75 ';

type ShellSearchProps = Omit<ComponentPropsWithoutRef<typeof InputGroup>, 'children'> & {
  open?: boolean;
};

function ShellSearch({ className, open = true, title, ...props }: ShellSearchProps) {
  const label = title ?? (open ? undefined : 'Search');

  return (
    <InputGroup
      className={cn(
        'relative h-10 w-full min-w-0 overflow-hidden rounded-[0.8rem] border-line bg-control',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out-strong motion-reduce:transition-none',
        className,
      )}
      title={label}
      {...props}
    >
      <InputGroupAddon className="pl-3 text-muted-foreground">
        <MagnifyingGlassIcon />
      </InputGroupAddon>

      <InputGroupInput
        aria-hidden={!open}
        className={cn(
          'h-full text-sm opacity-100 transition-[opacity,transform] duration-150 ease-out-strong disabled:opacity-0 motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-1',
        )}
        disabled={!open}
        placeholder="Search"
        tabIndex={open ? undefined : -1}
      />

      <InputGroupAddon
        align="inline-end"
        className={cn(
          'pointer-events-none pr-2 transition-[opacity,transform] duration-150 ease-out-strong motion-reduce:transition-none',
          open ? 'translate-x-0 opacity-100' : 'translate-x-1 opacity-0',
        )}
      >
        <KbdGroup>
          <Kbd className={key}>
            <span className="sr-only">Command</span>
            <CommandIcon className="size-3.5" />
          </Kbd>
          <Kbd className={key}>K</Kbd>
        </KbdGroup>
      </InputGroupAddon>
    </InputGroup>
  );
}

export { ShellSearch };
export type { ShellSearchProps };
