import { CommandIcon } from '@phosphor-icons/react';

import { CommandActionPopover } from '~/components/command-palette/actions';
import { actionTarget, useCommand } from '~/components/command-palette/context';
import { CommandGlyph, CommandKey, CommandPaletteButton } from '~/components/command-palette/parts';
import { current } from '~/components/command-palette/session';
import { KbdGroup } from '~/components/ui/kbd';
import { Popover, PopoverTrigger } from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

function CommandPaletteFooter() {
  const cmd = useCommand();
  const target = actionTarget(cmd) ?? cmd.item;
  const Icon = target?.icon ?? CommandIcon;
  const title = target?.primary.title ?? 'Open Command';
  const blocked = cmd.panel.kind === 'actions' && !!target;

  return (
    <Elevated
      data-command-palette-footer=""
      shadowLevel={2}
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 border-t border-border/75 px-3 py-2 text-xs text-muted-foreground',
        blocked && 'pointer-events-none select-none',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <CommandGlyph>
          <Icon aria-hidden className="size-3.5" />
        </CommandGlyph>
        <span className="truncate font-medium">{cmd.page.title}</span>
      </span>
      <div className="flex shrink-0 items-center gap-3">
        {current(cmd.state).id !== cmd.registry.root ? (
          <span className="hidden items-center gap-1.5 sm:flex">
            <span>Back</span>
            <CommandKey>⌫</CommandKey>
          </span>
        ) : null}
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="font-medium text-foreground">{title}</span>
          <CommandKey>↵</CommandKey>
        </span>
        <Separator className="h-4 bg-border/70" orientation="vertical" />
        <Popover
          open={cmd.panel.kind === 'actions' && !!cmd.item}
          onOpenChange={(open) => {
            if (!open) {
              cmd.dispatch({ type: 'close-actions' });
              cmd.focus();
            }
            if (open && target) cmd.dispatch({ type: 'open-actions', item: target.id });
          }}
        >
          <PopoverTrigger
            render={
              <CommandPaletteButton
                aria-label="Open command actions"
                className="h-7 rounded-md px-1.5 text-xs font-medium text-muted-foreground disabled:opacity-50"
                disabled={!target}
                size="xs"
                type="button"
                variant="ghost"
              />
            }
          >
            Actions
            <KbdGroup className="ml-1">
              <CommandKey>⌘</CommandKey>
              <CommandKey>K</CommandKey>
            </KbdGroup>
          </PopoverTrigger>
          {target && cmd.panel.kind === 'actions' ? <CommandActionPopover /> : null}
        </Popover>
      </div>
    </Elevated>
  );
}

export { CommandPaletteFooter };
