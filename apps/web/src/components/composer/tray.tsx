import type { ReactNode } from 'react';

import type { Mode } from '~/components/composer/commands';

import { ListChecksIcon, MagicWandIcon, modeLabel } from '~/components/composer/commands';
import { CommandIcon, PipeWrenchIcon } from '~/components/icons';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

export type ToolingState = 'disabled' | 'enabled';
export type TrayVisibility = 'collapsed' | 'expanded';

function ComposerTray(props: {
  chars: number;
  mode: Mode;
  tooling: ToolingState;
  visibility: TrayVisibility;
  onMode: (mode: Mode) => void;
  onTools: () => void;
}) {
  const collapsed = props.visibility === 'collapsed';

  return (
    <div
      aria-hidden={collapsed}
      className={cn(
        'relative z-10 flex min-w-0 items-center justify-between gap-3',
        'transition-opacity duration-150 ease-out-strong',
        collapsed && 'pointer-events-none opacity-0',
      )}
    >
      <div
        aria-label="Composer controls"
        className="inline-flex min-w-0 items-center gap-1 rounded-full border border-line bg-control p-1"
        role="group"
      >
        <Chip
          selected={props.mode === 'agent'}
          tabIndex={collapsed ? -1 : undefined}
          onClick={() => props.onMode('agent')}
        >
          <MagicWandIcon data-icon="inline-start" />
          {modeLabel('agent')}
        </Chip>

        <Chip
          selected={props.tooling === 'enabled'}
          tabIndex={collapsed ? -1 : undefined}
          onClick={props.onTools}
        >
          <PipeWrenchIcon data-icon="inline-start" />
          Tools
        </Chip>

        <Chip
          selected={props.mode === 'compact'}
          tabIndex={collapsed ? -1 : undefined}
          onClick={() => props.onMode('compact')}
        >
          <ListChecksIcon data-icon="inline-start" />
          Compact
        </Chip>
      </div>

      <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-control px-2 py-1 text-[11px] text-muted-foreground">
        <span className="min-w-[4.5ch] text-right tabular-nums">{formatChars(props.chars)}</span>

        <span aria-hidden className="h-4 w-px bg-line" />

        <KbdGroup>
          <Kbd className={key}>
            <span className="sr-only">Command</span>
            <CommandIcon className="size-3" />
          </Kbd>
          <Kbd className={key}>K</Kbd>
        </KbdGroup>
      </div>
    </div>
  );
}

function Chip(props: {
  children: ReactNode;
  selected: boolean;
  tabIndex?: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={props.selected}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium',
        'transition-[background-color,border-color,color] duration-150 ease-out-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
        '**:data-[icon=inline-start]:size-3.5 **:data-[icon=inline-start]:shrink-0',
        props.selected
          ? 'border-line bg-row text-foreground hover:border-line hover:bg-row'
          : 'border-transparent bg-transparent text-muted-foreground hover:border-line hover:bg-control-hover hover:text-foreground',
      )}
      tabIndex={props.tabIndex}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function formatChars(chars: number) {
  if (chars < 1000) {
    return `${chars} chars`;
  }

  return `${(chars / 1000).toFixed(1)}k chars`;
}

const key =
  'size-6 min-w-6 rounded-full border border-line bg-row p-0 text-[11px] text-foreground/75';

export { ComposerTray };
