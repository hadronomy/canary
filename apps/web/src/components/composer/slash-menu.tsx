import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';

import type { Cmd } from '~/components/composer/commands';

import { filter } from '~/components/composer/commands';
import { CommandIcon } from '~/components/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '~/components/ui/command';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

const COMMAND_ROW_HEIGHT = 48;
const COMMAND_ROW_GAP = 4;

export type SlashMenuState =
  | { kind: 'closed' }
  | {
      active: number;
      kind: 'open';
      query: string;
    };

function SlashMenu(props: {
  commands: Cmd[];
  state: SlashMenuState;
  onActive: (idx: number) => void;
  onPick: (cmd: Cmd) => void;
}) {
  const reduce = useReducedMotion();
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  const menu = props.state.kind === 'open' ? props.state : null;

  const items = useMemo(() => {
    if (!menu) {
      return [];
    }

    return filter(props.commands, menu.query);
  }, [menu, props.commands]);

  const active = menu ? Math.min(menu.active, Math.max(0, items.length - 1)) : 0;
  const selectionY = active * (COMMAND_ROW_HEIGHT + COMMAND_ROW_GAP);

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
    <AnimatePresence>
      {menu ? (
        <motion.div
          animate="open"
          className="pointer-events-auto absolute bottom-[calc(100%-1px)] left-1/2 z-40 w-[min(31rem,64%)] -translate-x-1/2 perspective-[1000px]"
          exit="closed"
          initial={reduce ? 'reduced' : 'closed'}
          variants={rootVariants}
        >
          <motion.div
            className="relative origin-bottom"
            style={{ transformOrigin: 'bottom center' }}
            variants={sheetVariants}
          >
            <Command
              className={cn(
                'relative overflow-hidden rounded-t-[1.15rem] rounded-b-none',
                'border-x border-t border-line border-b-transparent',
                'bg-background p-1',
                '',
              )}
              shouldFilter={false}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent" />

              <motion.div variants={contentVariants}>
                <CommandList className="max-h-52 p-1 pb-2">
                  <CommandEmpty className="px-3 py-7 text-center text-xs text-muted-foreground">
                    No slash commands found.
                  </CommandEmpty>

                  <CommandGroup
                    heading={menu.query ? `/${menu.query}` : 'Slash commands'}
                    className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:pt-1 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground"
                  >
                    <div className="relative flex flex-col" style={{ gap: COMMAND_ROW_GAP }}>
                      {items.length ? (
                        <motion.span
                          aria-hidden
                          animate={{ y: selectionY }}
                          className="pointer-events-none absolute inset-x-0 top-0 z-0 rounded-[0.8rem] border border-line bg-row-active "
                          initial={false}
                          style={{ height: COMMAND_ROW_HEIGHT }}
                          transition={reduce ? instantTransition : selectionTransition}
                        />
                      ) : null}

                      {items.map((cmd, idx) => {
                        const selected = idx === active;

                        return (
                          <CommandItem
                            key={cmd.id}
                            ref={(node) => {
                              itemRefs.current[idx] = node;
                            }}
                            aria-disabled={cmd.disabled}
                            data-disabled={cmd.disabled ? 'disabled' : 'enabled'}
                            data-state={selected ? 'active' : 'idle'}
                            value={cmd.id}
                            className={cn(
                              'relative z-10 flex w-full overflow-hidden rounded-[0.8rem] px-2 py-1.5',
                              'data-[selected=true]:bg-transparent!',
                              'data-[selected=true]:text-inherit',
                              'data-[state=active]:text-foreground',
                              'data-[disabled=disabled]:opacity-45',
                            )}
                            style={{ height: COMMAND_ROW_HEIGHT }}
                            onMouseEnter={() => props.onActive(idx)}
                            onPointerMove={() => {
                              if (idx !== active) {
                                props.onActive(idx);
                              }
                            }}
                            onSelect={() => {
                              if (cmd.disabled) {
                                return;
                              }

                              props.onPick(cmd);
                            }}
                          >
                            <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
                              <span className={iconClass}>
                                <cmd.icon className="size-3.5" />
                              </span>

                              <span className="min-w-0">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0 font-mono text-[12px] text-foreground">
                                    /{cmd.slash}
                                  </span>

                                  <span className="truncate text-xs font-medium text-foreground/86 group-data-selected/command-item:text-foreground group-data-[state=active]/command-item:text-foreground">
                                    {cmd.label}
                                  </span>
                                </span>

                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {cmd.desc}
                                </span>
                              </span>

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

function Shortcut(props: { value: string }) {
  const keys = shortcutParts(props.value);

  return (
    <CommandShortcut className="ml-0 shrink-0 justify-self-end tracking-normal text-inherit">
      {keys.length <= 1 ? (
        <Kbd className={kbdClass}>
          <Keycap value={keys[0] ?? props.value} />
        </Kbd>
      ) : (
        <KbdGroup className="gap-1">
          {keys.map((key) => (
            <Kbd key={key} className={kbdClass}>
              <Keycap value={key} />
            </Kbd>
          ))}
        </KbdGroup>
      )}
    </CommandShortcut>
  );
}

function Keycap(props: { value: string }) {
  const key = props.value.trim();

  if (commandKey(key)) {
    return (
      <>
        <span className="sr-only">Command</span>
        <CommandIcon className="size-3" />
      </>
    );
  }

  return <span>{labelKey(key)}</span>;
}

function shortcutParts(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.includes('+')) {
    return normalized
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (normalized.includes(' ')) {
    return normalized
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (normalized.length > 1 && normalized.startsWith('⌘')) {
    return ['⌘', normalized.slice(1)];
  }

  return [normalized];
}

function commandKey(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized === '⌘' ||
    normalized === 'cmd' ||
    normalized === 'command' ||
    normalized === 'meta' ||
    normalized === 'mod'
  );
}

function labelKey(value: string) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  if (lower === 'mod') {
    return '⌘';
  }

  if (lower === 'ctrl' || lower === 'control') {
    return 'Ctrl';
  }

  if (lower === 'alt' || lower === 'option') {
    return 'Alt';
  }

  if (lower === 'shift') {
    return 'Shift';
  }

  if (lower === 'enter' || lower === 'return') {
    return 'Enter';
  }

  if (lower === 'esc' || lower === 'escape') {
    return 'Esc';
  }

  if (lower === 'space') {
    return 'Space';
  }

  return normalized;
}

const iconClass = cn(
  'grid size-7 shrink-0 place-items-center rounded-[0.7rem] border border-line',
  'bg-control text-muted-foreground',
  'transition-colors duration-150 ease-(--ease-out-strong)',
  'group-data-selected/command-item:bg-control-hover',
  'group-data-selected/command-item:text-foreground',
  'group-data-[state=active]/command-item:bg-control-hover',
  'group-data-[state=active]/command-item:text-foreground',
);

const kbdClass = cn(
  'inline-grid h-6 min-w-6 place-items-center rounded-[0.55rem] px-1.5',
  'font-mono text-[11px] font-medium leading-none tracking-[-0.01em]',
  'border border-line',
  'bg-control',
  'text-foreground/60',
  '',
  'transition-[background,border-color,color,box-shadow,transform] duration-150 ease-(--ease-out-strong)',
  'group-data-selected/command-item:border-line-strong',
  'group-data-selected/command-item:bg-control-hover',
  'group-data-selected/command-item:text-foreground/82',
  'group-data-[state=active]/command-item:border-line-strong',
  'group-data-[state=active]/command-item:bg-control-hover',
  'group-data-[state=active]/command-item:text-foreground/82',
  '',
);

const rootVariants = {
  closed: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.12, ease },
  },
  open: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease },
  },
  reduced: {
    opacity: 0,
  },
};

const sheetVariants = {
  closed: {
    opacity: 1,
    rotateX: -5,
    scaleX: 0.86,
    scaleY: 0.04,
    y: 0,
    filter: 'blur(0px)',
    clipPath: 'inset(96% 14% 0% 14% round 1.15rem 1.15rem 0 0)',
    transition: { duration: 0.14, ease },
  },
  open: {
    opacity: 1,
    rotateX: 0,
    scaleX: 1,
    scaleY: 1,
    y: 0,
    filter: 'blur(0px)',
    clipPath: 'inset(0% 0% 0% 0% round 1.15rem 1.15rem 0 0)',
    transition: { duration: 0.22, ease },
  },
  reduced: {
    opacity: 0,
  },
};

const contentVariants = {
  closed: {
    opacity: 0,
    y: 6,
    transition: { duration: 0.08, ease },
  },
  open: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.08, duration: 0.14, ease },
  },
  reduced: {
    opacity: 0,
  },
};

const selectionTransition = {
  type: 'spring',
  stiffness: 720,
  damping: 54,
  mass: 0.62,
} as const;

const instantTransition = {
  duration: 0,
} as const;

export { SlashMenu };
