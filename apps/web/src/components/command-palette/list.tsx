import { ArrowBendUpLeftIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useRef } from 'react';

import type { CommandItem as Entry } from '~/components/command-palette/types';

import { useCommand } from '~/components/command-palette/context';
import { CommandPaletteButton, shortcutLabel } from '~/components/command-palette/parts';
import { current } from '~/components/command-palette/session';
import { Badge } from '~/components/ui/badge';
import { CommandGroup, CommandItem, CommandList, CommandShortcut } from '~/components/ui/command';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

function CommandBack() {
  const cmd = useCommand();

  if (current(cmd.state).id === cmd.registry.root) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border/65 px-3 pb-2 text-[10px] text-muted-foreground">
      <CommandPaletteButton
        className="h-6 rounded-md px-1.5"
        size="xs"
        type="button"
        variant="ghost"
        onClick={cmd.back}
      >
        <ArrowBendUpLeftIcon data-icon="inline-start" />
        Back
      </CommandPaletteButton>
      <Badge>{cmd.page.title}</Badge>
    </div>
  );
}

function CommandSections() {
  const cmd = useCommand();

  return (
    <CommandList className="scrollbar-visible max-h-[min(27rem,calc(100vh-13rem))] p-1">
      {cmd.flat.length === 0 ? <CommandPaletteEmpty query={current(cmd.state).query} /> : null}

      {cmd.page.sections.map((section) =>
        section.items.length ? (
          <CommandGroup heading={section.title} key={section.id}>
            <div className="grid gap-1">
              {section.items.map((item) => (
                <CommandPaletteRow item={item} key={item.id} />
              ))}
            </div>
          </CommandGroup>
        ) : null,
      )}
    </CommandList>
  );
}

function CommandPaletteRow(props: { item: Entry }) {
  const cmd = useCommand();
  const Icon = props.item.icon;
  const shortcut = props.item.actions.length > 1 ? 'Actions →' : shortcutLabel(props.item.primary);
  const click = useRef(false);

  return (
    <CommandItem
      className={cn(
        'h-10 min-h-10 gap-0 px-0 py-0 data-selected:hover:bg-active!',
        surfaceState.hover,
      )}
      keywords={[...props.item.keywords]}
      value={props.item.id}
      onClickCapture={() => {
        click.current = true;
      }}
      onDoubleClick={() => cmd.run(props.item)}
      onSelect={() => {
        if (click.current) {
          click.current = false;
          cmd.dispatch({ type: 'select', id: props.item.id });
          return;
        }

        cmd.run(props.item);
      }}
    >
      <span className="grid size-10 shrink-0 place-items-center">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="grid min-w-0 flex-1 pr-2">
        <span className="truncate">{props.item.title}</span>
        {props.item.subtitle ? (
          <span className="truncate text-[10px] leading-4 text-muted-foreground">
            {props.item.subtitle}
          </span>
        ) : null}
      </span>
      {shortcut ? <CommandShortcut className="mr-2.5">{shortcut}</CommandShortcut> : null}
    </CommandItem>
  );
}

function CommandPaletteEmpty(props: { query: string }) {
  return (
    <Empty className="border-0 p-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MagnifyingGlassIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No command found</EmptyTitle>
        <EmptyDescription>
          Nothing matches {props.query.trim() ? `“${props.query.trim()}”` : 'this view'}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>Try a thread title, route, theme action, or account action.</EmptyContent>
    </Empty>
  );
}

export { CommandBack, CommandSections };
