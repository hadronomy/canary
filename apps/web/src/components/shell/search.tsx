import type { ComponentPropsWithoutRef } from 'react';

import { CommandIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';

import { Button } from '~/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

const key =
  'size-6 min-w-6 rounded-[0.6rem] border border-border bg-card p-0 text-[13px] font-medium text-foreground/75 ';

type ShellSearchProps = Omit<
  ComponentPropsWithoutRef<typeof Elevated>,
  'children' | 'offset' | 'shadowLevel'
> & {
  onReveal?: () => void;
  open?: boolean;
};

function ShellSearch({ className, onReveal, open = true, title, ...props }: ShellSearchProps) {
  const label = title ?? (open ? undefined : 'Search');

  if (!open) {
    return (
      <CollapsedSearchButton
        className={className}
        label={label ?? 'Search'}
        onReveal={onReveal}
        {...props}
      />
    );
  }

  return <ExpandedSearchField className={className} title={label} {...props} />;
}

type ExpandedSearchFieldProps = Omit<
  ComponentPropsWithoutRef<typeof Elevated>,
  'children' | 'offset' | 'shadowLevel'
>;

function ExpandedSearchField({ className, ...props }: ExpandedSearchFieldProps) {
  return (
    <Elevated
      offset={1}
      shadowLevel={1}
      className={cn(
        'relative h-9 w-full min-w-0 overflow-hidden rounded-md border border-input/70',
        'transition-[border-color,background-color,box-shadow] duration-200 ease-out-strong motion-reduce:transition-none',
        'focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20',
        className,
      )}
      {...props}
    >
      <InputGroup className="h-full border-0 bg-transparent dark:bg-transparent">
        <InputGroupAddon className="pl-3 text-muted-foreground">
          <MagnifyingGlassIcon />
        </InputGroupAddon>

        <InputGroupInput className="h-full text-sm" placeholder="Search" />

        <InputGroupAddon
          align="inline-end"
          className={cn(
            'pointer-events-none translate-x-0 pr-2 opacity-100 transition-[opacity,transform] duration-150 ease-out-strong motion-reduce:transition-none',
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
    </Elevated>
  );
}

type CollapsedSearchButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Elevated>,
  'children' | 'offset' | 'shadowLevel' | 'title'
> & {
  label: string;
  onReveal?: () => void;
};

function CollapsedSearchButton({
  className,
  label,
  onReveal,
  ...props
}: CollapsedSearchButtonProps) {
  const button = (
    <Button
      aria-label={label}
      className={cn(
        'size-10 rounded-md border border-transparent bg-transparent text-muted-foreground',
        'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong motion-reduce:transition-none',
        'hover:border-input/55 hover:bg-surface-3/70 hover:text-foreground',
        'focus-visible:border-ring/50 focus-visible:bg-surface-3/70 focus-visible:ring-2 focus-visible:ring-ring/20',
      )}
      size="icon"
      type="button"
      variant="ghost"
      onClick={onReveal}
    >
      <MagnifyingGlassIcon aria-hidden="true" />
    </Button>
  );

  return (
    <Tooltip>
      <div className={cn('size-10', className)} {...props}>
        <TooltipTrigger render={button} />
      </div>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { ShellSearch };
export type { ShellSearchProps, ExpandedSearchFieldProps, CollapsedSearchButtonProps };
