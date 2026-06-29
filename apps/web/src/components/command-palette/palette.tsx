import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  Dispatch,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react';

import { ArrowBendUpLeftIcon, CommandIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { use, createContext, useReducer, useRef } from 'react';

import type {
  CommandAction,
  CommandContext,
  CommandEvent,
  CommandItem as CommandEntry,
  CommandPage,
  CommandPageResolver,
  CommandScreen,
  CommandSession,
  PageRef,
  PanelState,
} from '~/components/command-palette/types';

import {
  actionAccepts,
  actionById,
  byId,
  current,
  init,
  previous,
  reducer,
  screen,
} from '~/components/command-palette/model';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '~/components/ui/command';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import { Elevated } from '~/lib/elevated';
import { surfaceClasses, surfaceState } from '~/lib/surface-classes';
import { useSurface } from '~/lib/surface-context';
import { cn } from '~/lib/utils';

type CommandPaletteApi = {
  actions: () => void;
};

type CommandPaletteProps = Omit<
  ComponentPropsWithoutRef<typeof CommandDialog>,
  'children' | 'description' | 'onOpenChange' | 'open' | 'title'
> & {
  api?: RefObject<CommandPaletteApi | null>;
  description?: string;
  initial: CommandScreen;
  onOpenChange: (open: boolean) => void;
  onRemember: (id: string) => void;
  onScreen: (screen: CommandScreen) => void;
  open: boolean;
  resolve: CommandPageResolver;
  title?: string;
};

type CommandValue = {
  back: () => void;
  ctx: CommandContext;
  dispatch: Dispatch<CommandEvent>;
  flat: readonly CommandEntry[];
  focus: () => void;
  item: CommandEntry | null;
  map: Map<string, CommandEntry>;
  page: CommandPage;
  panel: PanelState;
  run: (item: CommandEntry) => void;
  runAction: (item: CommandEntry, action: CommandAction) => void;
  state: CommandSession;
};

const CommandCtx = createContext<CommandValue | null>(null);

function CommandPalette({
  api,
  className,
  description = 'Search navigation, conversations, and workspace actions.',
  initial,
  onOpenChange,
  onRemember,
  onScreen,
  open,
  resolve,
  title = 'Canary command palette',
  ...props
}: CommandPaletteProps) {
  const [state, dispatch] = useReducer(reducer, initial, init);
  const input = useRef<HTMLInputElement | null>(null);

  function close() {
    onOpenChange(false);
  }

  function focus() {
    input.current?.focus({ preventScroll: true });
  }

  function push(next: PageRef) {
    dispatch({ type: 'push', page: next });

    const value = screen(next);
    if (value) onScreen(value);
  }

  const ctx: CommandContext = {
    actions: (id) => {
      const item = id ?? view.item?.id;
      if (item) dispatch({ type: 'open-actions', item });
    },
    close,
    page: push,
  };

  function back() {
    const next = previous(state);

    dispatch({ type: 'back' });

    if (next) {
      const value = screen(next);
      if (value) onScreen(value);
    }
  }

  const page = resolve(state, ctx);
  const sections = page.sections.filter((item) => item.items.length);
  const flat = sections.flatMap((item) => item.items);
  const map = byId(flat);
  const item = state.selected ? (map.get(state.selected) ?? flat[0] ?? null) : (flat[0] ?? null);
  const panel =
    state.panel.kind === 'actions' && map.has(state.panel.item)
      ? state.panel
      : ({ kind: 'list' } satisfies PanelState);

  const view: CommandValue = {
    back,
    ctx,
    dispatch,
    flat,
    focus,
    item,
    map,
    page,
    panel,
    run,
    runAction,
    state,
  };

  if (api) {
    api.current = {
      actions: () => {
        if (view.item) dispatch({ type: 'open-actions', item: view.item.id });
      },
    };
  }

  function run(item: CommandEntry) {
    Promise.resolve(item.primary.run(ctx)).then(() => onRemember(item.id));
  }

  function runAction(item: CommandEntry, action: CommandAction) {
    dispatch({ type: 'close-actions' });
    Promise.resolve(action.run(ctx)).then(() => onRemember(item.id));
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (panel.kind === 'actions') {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') dispatch({ type: 'close-actions' });
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && page.submit) {
      const action = page.submit;

      event.preventDefault();
      Promise.resolve(action.run(ctx)).then(() => onRemember(action.id));
      return;
    }

    if (event.key === 'ArrowRight' && item?.actions.length) {
      event.preventDefault();
      dispatch({ type: 'open-actions', item: item.id });
      return;
    }

    if (
      event.key === 'Backspace' &&
      current(state).kind !== 'root' &&
      current(state).query === ''
    ) {
      event.preventDefault();
      back();
      return;
    }

    if (event.key !== 'Escape') return;

    if (current(state).kind !== 'root') {
      event.preventDefault();
      event.stopPropagation();
      back();
    }
  }

  function mouse(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return;

    event.preventDefault();

    if (panel.kind === 'list') focus();
  }

  return (
    <CommandDialog
      className={cn('w-[min(44rem,calc(100vw-2rem))] max-w-176! sm:max-w-176!', className)}
      description={description}
      open={open}
      title={title}
      onOpenChange={onOpenChange}
      {...props}
    >
      <CommandCtx value={view}>
        <Elevated
          data-command-palette-frame=""
          offset={0}
          shadowLevel={6}
          className="max-h-[min(42rem,calc(100vh-2rem))] overflow-hidden rounded-xl border border-border"
        >
          <Command
            disablePointerSelection
            label={title}
            loop
            shouldFilter={false}
            value={item?.id ?? ''}
            className="bg-transparent p-0"
            onKeyDown={key}
            onMouseDown={mouse}
            onValueChange={(id) => dispatch({ type: 'select', id })}
          >
            <div
              className={cn(
                'grid min-h-0',
                panel.kind === 'actions' && 'pointer-events-none select-none',
              )}
            >
              <section className="flex min-h-0 min-w-0 flex-col">
                <div>
                  <CommandInput
                    autoFocus
                    ref={input}
                    showIcon={false}
                    wrapperClassName={current(state).kind !== 'root' ? 'border-b-0' : undefined}
                    placeholder={page.placeholder}
                    value={current(state).query}
                    onValueChange={(query) => dispatch({ type: 'query', query })}
                  />

                  <CommandBack />
                </div>

                <CommandSections />
              </section>
            </div>

            <CommandPaletteFooter />
          </Command>
        </Elevated>
      </CommandCtx>
    </CommandDialog>
  );
}

function useCommand() {
  const ctx = use(CommandCtx);

  if (!ctx) {
    throw new Error('Command palette components must be rendered inside CommandPalette.');
  }

  return ctx;
}

function CommandBack() {
  const cmd = useCommand();

  if (current(cmd.state).kind === 'root') return null;

  function back() {
    cmd.back();
  }

  return (
    <div className="flex items-center gap-2 border-b border-border/65 px-3 pb-2 text-[10px] text-muted-foreground">
      <CommandPaletteButton
        className="h-6 rounded-md px-1.5"
        size="xs"
        type="button"
        variant="ghost"
        onClick={back}
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
  const empty = cmd.flat.length === 0;

  return (
    <CommandList className="scrollbar-visible max-h-[min(27rem,calc(100vh-13rem))] p-1">
      {empty ? <CommandPaletteEmpty query={current(cmd.state).query} /> : null}

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

function CommandPaletteRow(props: { item: CommandEntry }) {
  const cmd = useCommand();
  const Icon = props.item.icon;
  const shortcut = props.item.actions.length > 1 ? 'Actions →' : props.item.primary.shortcut;
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

function CommandPaletteFooter() {
  const cmd = useCommand();
  const Icon = cmd.item?.icon ?? CommandIcon;
  const title = cmd.item?.primary.title ?? 'Open Command';
  const blocked = cmd.panel.kind === 'actions' && !!cmd.item;

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
        {current(cmd.state).kind !== 'root' ? (
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
            if (open && cmd.item) cmd.dispatch({ type: 'open-actions', item: cmd.item.id });
          }}
        >
          <PopoverTrigger
            render={
              <CommandPaletteButton
                aria-label="Open command actions"
                className="h-7 rounded-md px-1.5 text-xs font-medium text-muted-foreground disabled:opacity-50"
                disabled={!cmd.item}
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
          {cmd.item && cmd.panel.kind === 'actions' ? <CommandActionPopover /> : null}
        </Popover>
      </div>
    </Elevated>
  );
}

function CommandActionPopover() {
  const cmd = useCommand();
  const input = useRef<HTMLInputElement | null>(null);

  if (!cmd.item || cmd.panel.kind !== 'actions') return null;

  const item = cmd.item;
  const panel = cmd.panel;
  const actions = item.actions.filter((item) => actionAccepts(item, panel.query));
  const map = actionById(actions);
  const active = panel.selected
    ? (map.get(panel.selected) ?? actions[0] ?? null)
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
      cmd.dispatch({
        type: 'action-select',
        id: shift(actions, active, 1)?.id ?? '',
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      cmd.dispatch({
        type: 'action-select',
        id: shift(actions, active, -1)?.id ?? '',
      });
      return;
    }

    if (event.key !== 'Enter' || !active) return;

    event.preventDefault();
    cmd.runAction(item, active);
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
          <p className="truncate text-xs font-medium text-muted-foreground">{item.title}</p>
        </div>

        <div className="grid max-h-56 gap-1 overflow-y-auto p-2">
          {actions.length ? (
            actions.map((action) => (
              <CommandActionRow
                action={action}
                active={action.id === active?.id}
                item={item}
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

function CommandActionRow(props: { action: CommandAction; active: boolean; item: CommandEntry }) {
  const cmd = useCommand();
  const Icon = props.action.icon;

  return (
    <div
      className={cn(
        'rounded-md border',
        props.active
          ? cn('border-border/70 hover:bg-active!', surfaceState.selected)
          : cn('border-transparent', surfaceState.hover),
      )}
    >
      <Button
        className={cn(
          'grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-0 rounded-md bg-transparent! py-0 pl-0 pr-2.5 text-xs hover:bg-transparent! active:translate-y-0!',
          props.active && 'text-foreground',
          props.action.tone === 'danger' && 'text-destructive hover:text-destructive',
        )}
        size="sm"
        type="button"
        variant="ghost"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => cmd.dispatch({ type: 'action-select', id: props.action.id })}
        onDoubleClick={() => cmd.runAction(props.item, props.action)}
      >
        <span className="flex size-8 shrink-0 items-center justify-center self-center leading-none">
          <Icon aria-hidden className="size-3.5" />
        </span>
        <span className="flex h-8 min-w-0 items-center self-center pr-3 text-left leading-none">
          <span className="truncate">{props.action.title}</span>
        </span>
        {props.action.shortcut ? (
          <span className="flex h-8 items-center justify-end self-center">
            <CommandKeys value={props.action.shortcut} />
          </span>
        ) : null}
      </Button>
    </div>
  );
}

function CommandKeys(props: { value: string }) {
  return (
    <KbdGroup className="h-8 items-center justify-end">
      {props.value.split(/\s+/).map((item) => (
        <CommandKey className="h-4 min-w-4 px-1 text-[10px]" key={item}>
          {label(item)}
        </CommandKey>
      ))}
    </KbdGroup>
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
      className={cn('bg-transparent hover:text-foreground', raised(), className)}
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
          raised(),
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
        raised(),
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

function raised() {
  return cn(
    surfaceState.hover,
    surfaceState.active,
    surfaceState.focus,
    surfaceState.open,
    'hover:!shadow-none focus-visible:!shadow-none aria-expanded:!shadow-none',
    'hover:ring-1 hover:ring-border/70 aria-expanded:ring-1 aria-expanded:ring-border/70',
  );
}

function shift(items: readonly CommandAction[], item: CommandAction | null, delta: number) {
  if (!items.length) return null;

  const at = item ? items.findIndex((next) => next.id === item.id) : -1;
  const next = at < 0 ? 0 : (at + delta + items.length) % items.length;

  return items[next] ?? null;
}

function label(value: string) {
  switch (value) {
    case 'Enter':
      return '↵';
    case 'Command':
    case 'Mod':
    case '⌘':
      return '⌘';
    default:
      return value;
  }
}

export { CommandCard, CommandPalette, CommandTrigger };
export type { CommandCardProps, CommandPaletteApi, CommandPaletteProps, CommandTriggerProps };
