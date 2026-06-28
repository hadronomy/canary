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

    item.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [active, menu, reduce]);

  return (
    <AnimatePresence initial={false}>
      {menu ? (
        <motion.div
          animate="open"
          className="pointer-events-auto absolute inset-x-0 bottom-[calc(100%-1px)] z-50 w-full perspective-distant"
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
                'relative overflow-hidden rounded-t-[1.35rem] rounded-b-none p-0',
                'border-x border-t border-border/80 border-b-0',
                'bg-card text-card-foreground shadow-[0_-18px_44px_-32px_rgb(0_0_0/0.55)]',
                className,
              )}
              shouldFilter={false}
              onMouseDown={(event) => event.preventDefault()}
              {...props}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-5 top-0 h-px bg-linear-to-r from-transparent via-input to-transparent"
              />

              <motion.div variants={contentVariants}>
                <MenuHeader query={menu.query} />

                <CommandList className="max-h-56 scroll-py-1 overflow-y-auto bg-card px-2 pb-2 pt-1.5 scrollbar-gutter-stable">
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
                              'data-[selected=true]:text-inherit',
                              'data-[state=active]:text-foreground',
                              'data-[disabled=disabled]:pointer-events-none data-[disabled=disabled]:opacity-45',
                            )}
                            style={{ height: COMMAND_ROW_HEIGHT }}
                            onMouseEnter={() => {
                              if (idx !== active) {
                                onActive(idx);
                              }
                            }}
                            onPointerMove={() => {
                              if (idx !== active) {
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
              </motion.div>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function MenuHeader(props: { query: string }) {
  const value = props.query ? `/${props.query}` : 'Type to filter slash commands';

  return (
    <div className="flex h-8 min-w-0 items-center gap-3 rounded-t-[calc(1.35rem-1px)] border-b border-border/70 bg-surface-4/45 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center text-muted-foreground/72">
          <CommandIcon aria-hidden className="size-3.5" />
        </span>

        <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
          Commands
        </span>

        <span className="h-3.5 w-px shrink-0 bg-border" />

        <span
          className="block min-w-0 truncate whitespace-nowrap text-[12px] text-muted-foreground"
          title={value}
        >
          {value}
        </span>
      </div>

      <div className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70 sm:flex">
        <span className="font-mono">↑↓</span>
        <span>navigate</span>
        <span className="mx-1 h-3 w-px bg-border" />
        <span className="font-mono">Enter</span>
        <span>select</span>
      </div>
    </div>
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

const selectionTransition = {
  type: 'spring',
  stiffness: 760,
  damping: 58,
  mass: 0.58,
} as const;

const instantTransition = {
  duration: 0,
} as const;

const rootVariants = {
  closed: {
    opacity: 1,
    transition: { duration: 0.12, ease },
  },
  open: {
    opacity: 1,
    transition: { duration: 0.18, ease },
  },
  reduced: {
    opacity: 0,
    transition: instantTransition,
  },
};

const sheetVariants = {
  closed: {
    opacity: 1,
    rotateX: -4,
    scaleX: 0.98,
    scaleY: 0.05,
    y: 0,
    filter: 'blur(0px)',
    clipPath: 'inset(96% 0% 0% 0% round 1.35rem 1.35rem 0 0)',
    transition: { duration: 0.14, ease },
  },
  open: {
    opacity: 1,
    rotateX: 0,
    scaleX: 1,
    scaleY: 1,
    y: 0,
    filter: 'blur(0px)',
    clipPath: 'inset(0% 0% 0% 0% round 1.35rem 1.35rem 0 0)',
    transition: { duration: 0.22, ease },
    transitionEnd: { clipPath: 'none' },
  },
  reduced: {
    opacity: 0,
    transition: instantTransition,
  },
};

const contentVariants = {
  closed: {
    opacity: 0,
    y: 5,
    transition: { duration: 0.08, ease },
  },
  open: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.06, duration: 0.14, ease },
  },
  reduced: {
    opacity: 0,
    transition: instantTransition,
  },
};

export { ComposerMenu };
export type { ComposerMenuProps };
