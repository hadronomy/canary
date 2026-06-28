import type { ComponentPropsWithoutRef } from 'react';

import { CommandIcon, ListChecksIcon, MagicWandIcon, PipeWrenchIcon } from '@phosphor-icons/react';

import type { Mode } from '~/components/composer/commands';

import { modeLabel } from '~/components/composer/commands';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group';
import { cn } from '~/lib/utils';

export type ToolingState = 'disabled' | 'enabled';
export type TrayVisibility = 'collapsed' | 'expanded';

type ComposerTrayProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  chars: number;
  mode: Mode;
  tooling: ToolingState;
  visibility: TrayVisibility;
  onMode: (mode: Mode) => void;
  onTools: () => void;
};

function ComposerTray({
  chars,
  className,
  mode: value,
  onMode,
  onTools,
  tooling,
  visibility,
  ...props
}: ComposerTrayProps) {
  const collapsed = visibility === 'collapsed';
  const mode = value === 'compact' ? 'compact' : 'agent';
  const tools = tooling === 'enabled';

  return (
    <div
      aria-hidden={collapsed}
      className={cn(
        'relative z-10 flex min-w-0 items-center justify-between gap-3',
        'transition-opacity duration-150 ease-out-strong',
        collapsed && 'pointer-events-none opacity-0',
        className,
      )}
      {...props}
    >
      <div
        aria-label="Composer controls"
        className="inline-flex min-w-0 items-center gap-1 rounded-full border border-line bg-control p-1"
        role="group"
      >
        <ToggleGroup
          aria-label="Composer mode"
          className="min-w-0"
          spacing={1}
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];

            if (value === 'agent' || value === 'compact') {
              onMode(value);
            }
          }}
        >
          <ToggleGroupItem className={item} tabIndex={collapsed ? -1 : undefined} value="agent">
            <MagicWandIcon data-icon="inline-start" />
            {modeLabel('agent')}
          </ToggleGroupItem>

          <ToggleGroupItem className={item} tabIndex={collapsed ? -1 : undefined} value="compact">
            <ListChecksIcon data-icon="inline-start" />
            Compact
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          aria-label="Composer tooling"
          multiple
          spacing={1}
          value={tools ? ['tools'] : []}
          onValueChange={(next) => {
            if (next.includes('tools') !== tools) {
              onTools();
            }
          }}
        >
          <ToggleGroupItem className={item} tabIndex={collapsed ? -1 : undefined} value="tools">
            <PipeWrenchIcon data-icon="inline-start" />
            Tools
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-control px-2 py-1 text-[11px] text-muted-foreground">
        <span className="min-w-[4.5ch] text-right tabular-nums">{formatChars(chars)}</span>

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

function formatChars(chars: number) {
  if (chars < 1000) {
    return `${chars} chars`;
  }

  return `${(chars / 1000).toFixed(1)}k chars`;
}

const key =
  'size-6 min-w-6 rounded-full border border-line bg-row p-0 text-[11px] text-foreground/75';

const item = cn(
  'h-7 rounded-full border border-transparent px-2.5 text-[11px]',
  'bg-transparent text-muted-foreground hover:border-line hover:bg-control-hover hover:text-foreground',
  'data-[pressed]:border-line data-[pressed]:bg-row data-[pressed]:text-foreground',
  '**:data-[icon=inline-start]:size-3.5 **:data-[icon=inline-start]:shrink-0',
);

export { ComposerTray };
export type { ComposerTrayProps };
