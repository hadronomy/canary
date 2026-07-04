import type { ComponentPropsWithRef, ComponentPropsWithoutRef } from 'react';

import { CommandIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { formatForDisplay } from '@tanstack/react-hotkeys';

import type { CommandAction } from '~/components/command-palette/types';

import { Button } from '~/components/ui/button';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { Elevated } from '~/lib/elevated';
import { surfaceClasses, surfaceState } from '~/lib/surface-classes';
import { useSurface } from '~/lib/surface-context';
import { cn } from '~/lib/utils';

type CommandPaletteButtonProps = ComponentPropsWithRef<typeof Button>;

function CommandPaletteButton({
  className,
  onMouseDown,
  ref,
  ...props
}: CommandPaletteButtonProps) {
  return (
    <Button
      ref={ref}
      className={cn(
        'bg-transparent hover:text-foreground',
        surfaceState.hover,
        surfaceState.active,
        surfaceState.focus,
        surfaceState.open,
        'hover:shadow-none! focus-visible:shadow-none! aria-expanded:shadow-none!',
        'hover:ring-1 hover:ring-border/70 aria-expanded:ring-1 aria-expanded:ring-border/70',
        className,
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.(event);
      }}
      {...props}
    />
  );
}

type CommandGlyphProps = ComponentPropsWithoutRef<'span'>;

function CommandGlyph({ className, ...props }: CommandGlyphProps) {
  const base = useSurface();

  return (
    <span
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground',
        surfaceClasses(base + 1, 1),
        className,
      )}
      {...props}
    />
  );
}

type CommandKeyProps = ComponentPropsWithoutRef<typeof Kbd>;

function CommandKey({ className, ...props }: CommandKeyProps) {
  const base = useSurface();

  return (
    <Kbd
      className={cn(
        'border border-border/70 text-foreground/75',
        surfaceClasses(base + 1, 1),
        className,
      )}
      {...props}
    />
  );
}

type CommandCardProps = ComponentPropsWithoutRef<typeof Elevated> & {
  label: string;
  title: string;
  value: string;
};

function CommandCard({ className, label, title, value, ...props }: CommandCardProps) {
  return (
    <Elevated
      shadowLevel={1}
      className={cn('rounded-md border border-input/60 p-2', className)}
      {...props}
    >
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-foreground">{title}</p>
      <p className="truncate text-[10px] text-muted-foreground">{value}</p>
    </Elevated>
  );
}

type CommandTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  'children' | 'onClick' | 'size' | 'type'
> & {
  compact?: boolean;
  onOpen: () => void;
};

function CommandTrigger({ className, compact = false, onOpen, ...props }: CommandTriggerProps) {
  if (compact) {
    return (
      <Button
        aria-label="Open command palette"
        className={cn(
          'size-10 rounded-md border border-transparent bg-transparent text-muted-foreground',
          'hover:border-transparent hover:text-foreground',
          'focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20',
          surfaceState.hover,
          surfaceState.active,
          surfaceState.focus,
          surfaceState.open,
          'hover:shadow-none! focus-visible:shadow-none! aria-expanded:shadow-none!',
          'hover:ring-1 hover:ring-border/70 aria-expanded:ring-1 aria-expanded:ring-border/70',
          className,
        )}
        size="icon"
        type="button"
        variant="ghost"
        {...props}
        onClick={onOpen}
      >
        <MagnifyingGlassIcon aria-hidden />
      </Button>
    );
  }

  return (
    <Button
      className={cn(
        'h-9 w-full justify-start gap-2 rounded-md border-input/70 bg-transparent px-3 text-muted-foreground hover:text-foreground',
        surfaceState.hover,
        surfaceState.active,
        surfaceState.focus,
        surfaceState.open,
        'hover:shadow-none! focus-visible:shadow-none! aria-expanded:shadow-none!',
        'hover:ring-1 hover:ring-border/70 aria-expanded:ring-1 aria-expanded:ring-border/70',
        className,
      )}
      size="lg"
      type="button"
      variant="outline"
      {...props}
      onClick={onOpen}
    >
      <MagnifyingGlassIcon aria-hidden data-icon="inline-start" />
      <span className="min-w-0 flex-1 text-left">Command palette</span>
      <KbdGroup aria-hidden className="ml-auto gap-1">
        <Kbd className="size-5 min-w-5 bg-background/40 p-0 text-[11px]">
          <CommandIcon />
        </Kbd>
        <Kbd className="size-5 min-w-5 bg-background/40 p-0 text-[11px]">K</Kbd>
      </KbdGroup>
    </Button>
  );
}

function CommandKeys(props: { action: CommandAction }) {
  const parts = shortcutParts(props.action);

  if (!parts.length) return null;

  return (
    <KbdGroup className="h-8 items-center justify-end">
      {parts.map((item, index) => (
        <CommandKey className="h-4 min-w-4 px-1 text-[10px]" key={`${item}-${index}`}>
          <ShortcutKey value={item} />
        </CommandKey>
      ))}
    </KbdGroup>
  );
}

function shortcutLabel(action: CommandAction) {
  if (action.label) return action.label;
  if (!action.hotkey) return undefined;

  return formatForDisplay(action.hotkey, { separatorToken: ' ' });
}

function shortcutParts(action: CommandAction) {
  const value = shortcutLabel(action);

  return value
    ? value
        .split(/\s*\+\s*|\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function ShortcutKey(props: { value: string }) {
  const value = props.value.trim();

  if (value === '⌘') {
    return (
      <>
        <span className="sr-only">Command</span>
        <CommandIcon aria-hidden className="size-3" />
      </>
    );
  }

  return <span>{value}</span>;
}

export {
  CommandCard,
  CommandGlyph,
  CommandKey,
  CommandKeys,
  CommandPaletteButton,
  CommandTrigger,
  shortcutLabel,
};
export type { CommandCardProps, CommandTriggerProps };
