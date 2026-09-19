import type { ReactNode } from 'react';

import { ListChecksIcon, MagicWandIcon, PipeWrenchIcon } from '@phosphor-icons/react';

import type { Mode } from '~/components/composer/commands';

import { modeLabel } from '~/components/composer/commands';
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group';
import { cn } from '~/lib/utils';

export type ToolingState = 'disabled' | 'enabled';

type ComposerTrayProps = {
  chars: number;
  children?: ReactNode;
  className?: string;
  mode: Mode;
  tooling: ToolingState;
  onMode: (mode: Mode) => void;
  onTools: () => void;
};

/**
 * The composer's controls, along the bottom of the writing surface.
 *
 * Everything here is on the same surface as the text rather than in a panel of
 * its own, and nothing about it collapses. A row that appears on hover has to
 * be found before it can be used, and it was resizing the composer under the
 * pointer to do it.
 *
 * `children` is the send control. It belongs at the end of this row and not
 * beside the text, where it was standing in the writing area and narrowing
 * every line by its own width.
 */
function ComposerTray({
  chars,
  children,
  className,
  mode: value,
  onMode,
  onTools,
  tooling,
}: ComposerTrayProps) {
  const mode = value === 'compact' ? 'compact' : 'agent';
  const tools = tooling === 'enabled';

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
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
        <ToggleGroupItem className={item} value="agent">
          <MagicWandIcon data-icon="inline-start" />
          {modeLabel('agent')}
        </ToggleGroupItem>

        <ToggleGroupItem className={item} value="compact">
          <ListChecksIcon data-icon="inline-start" />
          Compact
        </ToggleGroupItem>
      </ToggleGroup>

      <span aria-hidden className="h-4 w-px shrink-0 bg-border" />

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
        <ToggleGroupItem className={item} value="tools">
          <PipeWrenchIcon data-icon="inline-start" />
          Tools
        </ToggleGroupItem>
      </ToggleGroup>

      <span className="ml-auto flex shrink-0 items-center gap-2.5">
        {/* Only worth the space once there is enough text for the number to
            mean something. Below that it is a zero taking up a column. */}
        {chars > 0 ? (
          <span className="hidden tabular-nums text-[11px] text-muted-foreground sm:block">
            {count(chars)}
          </span>
        ) : null}

        {children}
      </span>
    </div>
  );
}

function count(chars: number) {
  if (chars < 1000) {
    return `${chars}`;
  }

  return `${(chars / 1000).toFixed(1)}k`;
}

const item = cn(
  'h-7 rounded-full border border-transparent px-2.5 text-[11px]',
  'bg-transparent text-muted-foreground',
  'transition-[background-color,border-color,color] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
  'hover:bg-hover hover:text-foreground',
  'data-[pressed]:border-input/50 data-[pressed]:bg-surface-5 data-[pressed]:text-foreground',
  '**:data-[icon=inline-start]:size-3.5 **:data-[icon=inline-start]:shrink-0',
);

export { ComposerTray };
export type { ComposerTrayProps };
