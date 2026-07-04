import type { KeyboardEvent, MouseEvent } from 'react';

import { useReducer, useRef } from 'react';

import type { CommandPaletteProps, CommandValue } from '~/components/command-palette/context';
import type {
  CommandAction,
  CommandItem,
  PageId,
  PanelState,
} from '~/components/command-palette/types';

import { CommandCtx } from '~/components/command-palette/context';
import { CommandPaletteFooter } from '~/components/command-palette/footer';
import { useCommandHotkeys } from '~/components/command-palette/hotkeys';
import { CommandBack, CommandSections } from '~/components/command-palette/list';
import { resolveCommandSections } from '~/components/command-palette/ranking';
import { current, init, previous, reducer } from '~/components/command-palette/session';
import { itemId } from '~/components/command-palette/types';
import { Command, CommandDialog, CommandInput } from '~/components/ui/command';
import { Elevated } from '~/lib/elevated';
import { cn } from '~/lib/utils';

function CommandPalette({
  api,
  className,
  description = 'Search navigation, conversations, and workspace actions.',
  initial,
  onOpenChange,
  onPage,
  onReset,
  onUse,
  open,
  registry,
  title = 'Canary command palette',
  toggle,
  usage,
  ...props
}: CommandPaletteProps) {
  const [state, dispatch] = useReducer(reducer, initial, init);
  const input = useRef<HTMLInputElement | null>(null);
  const ref = current(state);
  const root = registry.pages.get(registry.root);
  const found = registry.pages.get(ref.id) ?? root;

  if (!found) {
    throw new Error(`Command palette is missing root page "${registry.root}".`);
  }

  const page = found;
  const sections = resolveCommandSections(registry, page, ref.query, usage);
  const flat = sections.flatMap((item) => item.items);
  const item = state.selected
    ? (registry.items.get(state.selected) ?? flat[0] ?? null)
    : (flat[0] ?? null);
  const panel =
    state.panel.kind === 'actions' && registry.items.has(state.panel.item)
      ? state.panel
      : ({ kind: 'list' } satisfies PanelState);

  function close() {
    onOpenChange(false);
  }

  function copy(value: string) {
    return navigator.clipboard.writeText(value);
  }

  function focus() {
    input.current?.focus({ preventScroll: true });
  }

  function push(page: PageId, query?: string) {
    dispatch({ type: 'push', page, query });
    onPage(page);
    requestAnimationFrame(focus);
  }

  const ctx = {
    actions: (id) => {
      const next = id ?? item?.id;
      if (next) dispatch({ type: 'open-actions', item: next });
    },
    close,
    copy,
    page: push,
    query: ref.query,
  } satisfies CommandValue['ctx'];

  function back() {
    const next = previous(state);

    dispatch({ type: 'back' });

    if (next) onPage(next.id);
  }

  function run(item: CommandItem) {
    const query = ref.query;

    Promise.resolve(item.primary.run(ctx)).then(() => {
      dispatch({ type: 'commit' });
      onUse(item.id, query);
    });
  }

  function runAction(item: CommandItem, action: CommandAction) {
    const query = ref.query;

    if (!action.stay) dispatch({ type: 'close-actions' });
    Promise.resolve(action.run(ctx)).then(() => {
      dispatch({ type: 'commit', keepPanel: action.stay });
      if (action.learn !== false) onUse(item.id, query);
    });
  }

  function submit() {
    const action = page.submit;
    const query = ref.query;

    if (!action) return;

    Promise.resolve(action.run(ctx)).then(() => {
      const owner = registry.actions.get(action.id)?.item.id;

      dispatch({ type: 'commit' });
      if (owner) onUse(owner, query);
    });
  }

  const view: CommandValue = {
    back,
    ctx,
    dispatch,
    flat,
    focus,
    item,
    page: { ...page, sections },
    panel,
    registry,
    reset: onReset,
    run,
    runAction,
    state,
    usage,
  };

  if (api) {
    api.current = {
      actions: () => {
        if (view.item) dispatch({ type: 'open-actions', item: view.item.id });
      },
    };
  }

  useCommandHotkeys({
    actions: () => {
      if (item) dispatch({ type: 'open-actions', item: item.id });
    },
    item,
    onOpenChange,
    open,
    runAction,
    submit: page.submit,
    submitRun: submit,
    toggle,
  });

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (panel.kind === 'actions') {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') dispatch({ type: 'close-actions' });
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && page.submit) {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'ArrowRight' && item?.actions.length) {
      event.preventDefault();
      dispatch({ type: 'open-actions', item: item.id });
      return;
    }

    if (event.key === 'Backspace' && ref.id !== registry.root && ref.query === '') {
      event.preventDefault();
      back();
      return;
    }

    if (event.key !== 'Escape') return;

    if (ref.id !== registry.root) {
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
            onValueChange={(id) => dispatch({ type: 'select', id: itemId(id) })}
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
                    wrapperClassName={ref.id !== registry.root ? 'border-b-0' : undefined}
                    placeholder={page.placeholder}
                    value={ref.query}
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

export { CommandPalette };
