import { CommandIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ComponentPropsWithoutRef, useEffect, useMemo, useRef } from 'react';

import type { Cmd } from '~/components/composer/commands';

import { filter } from '~/components/composer/commands';
import { ComposerShortcut } from '~/components/composer/shortcut';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '~/components/ui/command';
import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

const COMMAND_ROW_HEIGHT = 34;
const COMMAND_ROW_GAP = 3;

/**
 * The composer's corner radius, as a length `clip-path` can interpolate.
 *
 * Framer animates `clipPath` by parsing the string, so the `round` leg cannot
 * be a `var()`. If `--radius-composer` moves, move this with it — the menu
 * meets the box edge to edge and a mismatch shows as a step in the corner.
 */
const RADIUS = '1.5rem';

export type ComposerMenuState =
  | { kind: 'closed' }
  | {
      active: number;
      kind: 'open';
      query: string;
    };

type ComposerMenuProps = Omit<
  ComponentPropsWithoutRef<typeof Command>,
  'children' | 'onMouseDown' | 'shouldFilter'
> & {
  commands: Cmd[];
  state: ComposerMenuState;
  onActive: (idx: number) => void;
  onPick: (cmd: Cmd) => void;
};

function ComposerMenu({
  className,
  commands,
  onActive,
  onPick,
  state,
  ...props
}: ComposerMenuProps) {
  const reduce = useReducedMotion();
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  /**
   * Where the pointer actually was, so a scroll cannot pose as a hover.
   *
   * Arrowing through the list scrolls it, which slides a new row under a
   * stationary cursor and fires the pointer events as if the person had moved
   * there — the selection jumps back to wherever the mouse happens to rest.
   * A move only counts when the coordinates change.
   */
  const spot = useRef<null | { x: number; y: number }>(null);

  const menu = state.kind === 'open' ? state : null;

  const items = useMemo(() => {
    if (!menu) {
      return [];
    }

    return filter(commands, menu.query);
  }, [commands, menu]);

  const active = menu ? Math.min(menu.active, Math.max(0, items.length - 1)) : 0;
  const selectionY = active * (COMMAND_ROW_HEIGHT + COMMAND_ROW_GAP);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length);
  }, [items.length]);

  useEffect(() => {
    if (!menu) {
      itemRefs.current = [];
      return;
    }

    const item = itemRefs.current[active];

    if (!item) {
      return;
    }

    // Never smooth. Arrow keys are held down, and a smoothed scroll cannot
    // keep up with the repeat rate — the list falls behind the selection and
    // the menu feels like it is lagging the keyboard.
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, menu]);

  return (
    <AnimatePresence initial={false}>
      {menu ? (
        <motion.div
          animate="open"
          className="pointer-events-auto absolute inset-x-0 bottom-[calc(100%-1px)] z-50 w-full"
          exit={reduce ? 'reduced' : 'closed'}
          initial={reduce ? false : 'closed'}
          variants={rootVariants}
        >
          <motion.div
            className="relative origin-bottom"
            style={{ transformOrigin: 'bottom center' }}
            variants={sheetVariants}
          >
            <Command
              className={cn(
                'canary-menu relative overflow-hidden rounded-t-(--radius-composer) rounded-b-none p-0',
                'border-x border-t border-b-0 text-card-foreground',
                className,
              )}
              shouldFilter={false}
              onMouseDown={(event) => event.preventDefault()}
              {...props}
            >
              <div>
                <MenuHeader shown={items.length} total={commands.length} />

                <CommandList
                  className={cn(
                    'max-h-56 scroll-py-1 overflow-y-auto px-2 pb-2 pt-1.5 scrollbar-gutter-stable',
                    // Ten commands do not fit, and a hard cut through a row
                    // reads as a rendering fault rather than as more below.
                    '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]',
                  )}
                >
                  <CommandEmpty className="px-3 py-7 text-center text-xs text-muted-foreground">
                    No slash commands found.
                  </CommandEmpty>

                  <CommandGroup className="p-0">
                    <div className="relative flex flex-col" style={{ gap: COMMAND_ROW_GAP }}>
                      {items.length ? (
                        <motion.span
                          aria-hidden
                          animate={{ y: selectionY }}
                          className={cn(
                            'pointer-events-none absolute inset-x-0 top-0 z-0',
                            'rounded-md bg-accent',
                          )}
                          initial={false}
                          style={{ height: COMMAND_ROW_HEIGHT }}
                          transition={reduce ? instantTransition : selectionTransition}
                        />
                      ) : null}

                      {items.map((cmd, idx) => {
                        const selected = idx === active;
                        const disabled = Boolean(cmd.disabled);

                        return (
                          <CommandItem
                            key={cmd.id}
                            ref={(node) => {
                              itemRefs.current[idx] = node;
                            }}
                            aria-disabled={disabled}
                            data-disabled={disabled ? 'disabled' : 'enabled'}
                            data-state={selected ? 'active' : 'idle'}
                            disabled={disabled}
                            value={cmd.id}
                            className={cn(
                              'group/command-item relative z-10 flex w-full overflow-hidden rounded-md',
                              'px-2.5 py-0 text-left outline-none',
                              'data-[selected=true]:bg-transparent!',
                              'data-[selected=true]:shadow-none!',
                              'data-[selected=true]:ring-0!',
                              'data-[selected=true]:text-inherit',
                              'data-[state=active]:text-foreground',
                              'data-[disabled=disabled]:pointer-events-none data-[disabled=disabled]:opacity-45',
                            )}
                            style={{ height: COMMAND_ROW_HEIGHT }}
                            onPointerMove={(event) => {
                              const last = spot.current;
                              const moved =
                                !last || last.x !== event.clientX || last.y !== event.clientY;

                              spot.current = { x: event.clientX, y: event.clientY };

                              if (moved && idx !== active) {
                                onActive(idx);
                              }
                            }}
                            onSelect={() => {
                              if (disabled) {
                                return;
                              }

                              onPick(cmd);
                            }}
                          >
                            <div className="grid min-w-0 flex-1 grid-cols-[1.25rem_minmax(4rem,7rem)_minmax(0,1fr)_auto] items-center gap-2.5">
                              <span className={iconClass}>
                                <cmd.icon aria-hidden className="size-3.5" />
                              </span>

                              <SlashToken value={`/${cmd.slash}`} />

                              <CommandSummary cmd={cmd} />

                              {cmd.key ? <Shortcut value={cmd.key} /> : null}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </div>
                  </CommandGroup>
                </CommandList>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function MenuHeader(props: { shown: number; total: number }) {
  // The query is already on screen in the composer a few pixels below, so
  // echoing it here says nothing. What is not visible anywhere else is how
  // much the filter has cut, which is the one thing worth the row.
  const label =
    props.shown === props.total ? `${props.total} commands` : `${props.shown} of ${props.total}`;

  return (
    <div className="flex h-8 min-w-0 items-center gap-2.5 rounded-t-[calc(var(--radius-composer)-1px)] border-b border-border/70 px-4.5">
      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground/70">
        <CommandIcon aria-hidden className="size-3.5" />
      </span>

      <span className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">
        {label}
      </span>

      <span className="ml-auto hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground/70 sm:flex">
        <Hint keys="↑↓">navigate</Hint>
        <span aria-hidden className="h-3 w-px bg-border" />
        <Hint keys="↵">select</Hint>
      </span>
    </div>
  );
}

function Hint(props: { children: string; keys: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="font-mono text-foreground/60">{props.keys}</span>
      {props.children}
    </span>
  );
}

function SlashToken(props: { value: string }) {
  return (
    <span
      className={cn(
        'block min-w-0 truncate whitespace-nowrap',
        'font-mono text-[12px] leading-none tracking-[-0.02em]',
        'text-foreground/78',
        'group-data-[state=active]/command-item:text-foreground',
        'group-data-selected/command-item:text-foreground',
      )}
      title={props.value}
    >
      {props.value}
    </span>
  );
}

function CommandSummary(props: { cmd: Cmd }) {
  const title = props.cmd.desc ? `${props.cmd.label} · ${props.cmd.desc}` : props.cmd.label;

  return (
    <span
      className={cn(
        'block min-w-0 truncate whitespace-nowrap',
        'text-[12px] font-medium leading-none tracking-[-0.01em]',
        'text-foreground/82',
        'group-data-[state=active]/command-item:text-foreground',
        'group-data-selected/command-item:text-foreground',
      )}
      title={title}
    >
      <span>{props.cmd.label}</span>

      {props.cmd.desc ? (
        <>
          <span aria-hidden className="mx-1 text-muted-foreground/70">
            ·
          </span>
          <span className="text-muted-foreground">{props.cmd.desc}</span>
        </>
      ) : null}
    </span>
  );
}

function Shortcut(props: { value: NonNullable<Cmd['key']> }) {
  return (
    <CommandShortcut className="ml-0 shrink-0 justify-self-end tracking-normal text-inherit">
      <ComposerShortcut value={props.value} kbdClassName={kbdClass} />
    </CommandShortcut>
  );
}

const iconClass = cn(
  'grid size-5 shrink-0 place-items-center',
  'text-muted-foreground/72',
  'transition-[color,transform] duration-150 ease-(--ease-out-strong)',
  'group-data-selected/command-item:text-foreground/82',
  'group-data-[state=active]/command-item:text-foreground/82',
);

const kbdClass = cn(
  'inline-grid h-5 min-w-5 place-items-center rounded-sm px-1.5',
  'font-mono text-[10px] font-medium leading-none tracking-[-0.01em]',
  'border border-border/70 bg-card/80 text-muted-foreground',
  'transition-[border-color,color,background] duration-150 ease-(--ease-out-strong)',
  'group-data-selected/command-item:border-input',
  'group-data-selected/command-item:bg-background/65',
  'group-data-selected/command-item:text-foreground/82',
  'group-data-[state=active]/command-item:border-input',
  'group-data-[state=active]/command-item:bg-background/65',
  'group-data-[state=active]/command-item:text-foreground/82',
);

// Overdamped at the old figures (zeta about 1.4), which reads as the highlight
// dragging itself to the next row. Stated as duration and bounce instead: no
// overshoot, but it arrives instead of easing in forever. A spring rather than
// a tween because holding an arrow key retargets it mid-flight, and a spring
// keeps its velocity across the interruption where a tween restarts.
const selectionTransition = {
  type: 'spring',
  duration: 0.19,
  bounce: 0,
} as const;

const instantTransition = {
  duration: 0,
} as const;

const rootVariants = {
  closed: {
    opacity: 0,
    transition: { duration: 0.11, ease },
  },
  open: {
    opacity: 1,
    transition: { duration: 0.14, ease },
  },
  reduced: {
    opacity: 0,
    transition: instantTransition,
  },
};

// One mechanism for the reveal, not three. This used to run a clip-path wipe,
// a scaleY to 0.05 and a rotateX together: the scale crushed every row to a
// fifth of a line of text on the way in, which is why a separate fade had to
// be layered over the content to hide it. The wipe alone is honest — rows are
// full size for every frame they are visible — and it needs nothing hiding it.
const sheetVariants = {
  closed: {
    y: 4,
    clipPath: `inset(100% 0% 0% 0% round ${RADIUS} ${RADIUS} 0 0)`,
    transition: { duration: 0.13, ease },
  },
  open: {
    y: 0,
    clipPath: `inset(0% 0% 0% 0% round ${RADIUS} ${RADIUS} 0 0)`,
    transition: { duration: 0.2, ease },
    // Released once open so the shadow is not clipped at rest.
    transitionEnd: { clipPath: 'none' },
  },
  reduced: {
    y: 0,
    transition: instantTransition,
  },
};

export { ComposerMenu };
export type { ComposerMenuProps };
