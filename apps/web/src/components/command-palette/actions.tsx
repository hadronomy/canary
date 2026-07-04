import type { KeyboardEvent, MouseEvent } from 'react';

import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { useRef } from 'react';

import type { CommandValue } from '~/components/command-palette/context';
import type { CommandAction, CommandItem } from '~/components/command-palette/types';

import { actionTarget, useCommand } from '~/components/command-palette/context';
import { CommandKeys } from '~/components/command-palette/parts';
import { actionAccepts } from '~/components/command-palette/text';
import { actionId } from '~/components/command-palette/types';
import { PopoverContent } from '~/components/ui/popover';
import { Elevated } from '~/lib/elevated';
import { surfaceState } from '~/lib/surface-classes';
import { cn } from '~/lib/utils';

function CommandActionPopover() {
  const cmd = useCommand();
  const input = useRef<HTMLInputElement | null>(null);
  const item = actionTarget(cmd);

  if (!item || cmd.panel.kind !== 'actions') return null;

  const target = item;
  const panel = cmd.panel;
  const actions = actionsFor(cmd, target).filter((item) => actionAccepts(item, panel.query));
  const active = panel.selected
    ? (actions.find((item) => item.id === panel.selected) ?? actions[0] ?? null)
    : (actions[0] ?? null);

  function key(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cmd.dispatch({ type: 'close-actions' });
      cmd.focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = shift(actions, active, 1);

      if (next) cmd.dispatch({ type: 'action-select', id: next.id });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = shift(actions, active, -1);

      if (next) cmd.dispatch({ type: 'action-select', id: next.id });
      return;
    }

    if (event.key !== 'Enter' || !active) return;

    event.preventDefault();
    cmd.runAction(target, active);
  }

  function mouse(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return;

    event.preventDefault();
    input.current?.focus({ preventScroll: true });
  }

  return (
    <PopoverContent
      align="end"
      side="top"
      sideOffset={10}
      className="w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-transparent p-0 shadow-none ring-0"
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={mouse}
    >
      <Elevated shadowLevel={2} className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border/65 px-2.5 py-2">
          <p className="truncate text-xs font-medium text-muted-foreground">{target.title}</p>
        </div>

        <div className="grid max-h-56 gap-1 overflow-y-auto p-2">
          {actions.length ? (
            actions.map((action) => (
              <CommandActionRow
                action={action}
                active={action.id === active?.id}
                item={target}
                key={action.id}
              />
            ))
          ) : (
            <p className="px-2 py-5 text-center text-xs text-muted-foreground">
              No matching actions.
            </p>
          )}
        </div>

        <div className="border-t border-border/75 bg-surface-3/80 px-2.5">
          <input
            autoFocus
            ref={input}
            aria-label="Search command actions"
            className="h-8 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            placeholder="Search for actions..."
            value={panel.query}
            onChange={(event) =>
              cmd.dispatch({ type: 'action-query', query: event.currentTarget.value })
            }
            onKeyDown={key}
          />
        </div>
      </Elevated>
    </PopoverContent>
  );
}

function actionsFor(cmd: CommandValue, item: CommandItem) {
  if (!cmd.usage.has(item.id)) return item.actions;

  return [
    ...item.actions,
    {
      icon: ClockCounterClockwiseIcon,
      id: actionId(`${item.id}:reset-ranking`),
      learn: false,
      run: () => cmd.reset(item.id),
      stay: true,
      title: 'Reset Ranking',
    },
  ] satisfies readonly CommandAction[];
}

function CommandActionRow(props: { action: CommandAction; active: boolean; item: CommandItem }) {
  const cmd = useCommand();
  const Icon = props.action.icon ?? props.item.icon;

  return (
    <div
      className={cn(
        'rounded-md border',
        props.active
          ? cn('border-border/70 hover:bg-active!', surfaceState.selected)
          : cn('border-transparent', surfaceState.hover),
      )}
    >
      <button
        className={cn(
          'grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-transparent py-0 pl-0 pr-2 text-xs font-medium leading-none text-foreground outline-none transition-colors hover:bg-transparent active:translate-y-0',
          'focus-visible:ring-2 focus-visible:ring-ring/20',
          props.active && 'text-foreground',
          props.action.tone === 'danger' && 'text-destructive hover:text-destructive',
        )}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => cmd.dispatch({ type: 'action-select', id: props.action.id })}
        onDoubleClick={() => cmd.runAction(props.item, props.action)}
      >
        <span className="grid size-8 shrink-0 place-items-center">
          <Icon aria-hidden className="block size-3.5" />
        </span>
        <span className="min-w-0 pr-3 text-left">
          <span className="block truncate leading-none">{props.action.title}</span>
        </span>
        {props.action.hotkey || props.action.label ? (
          <span className="flex h-8 items-center justify-end">
            <CommandKeys action={props.action} />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function shift(items: readonly CommandAction[], item: CommandAction | null, delta: number) {
  if (!items.length) return null;

  const at = item ? items.findIndex((next) => next.id === item.id) : -1;
  const next = at < 0 ? 0 : (at + delta + items.length) % items.length;

  return items[next] ?? null;
}

export { CommandActionPopover };
