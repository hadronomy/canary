import type { ReactNode } from 'react';

import { LayoutGroup, motion } from 'motion/react';

import type { Mode } from '~/components/composer/commands';

import { ListChecksIcon, MagicWandIcon, modeLabel } from '~/components/composer/commands';
import { CommandIcon, PipeWrenchIcon } from '~/components/icons';
import { Kbd, KbdGroup } from '~/components/ui/kbd';
import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

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
  if (props.visibility === 'collapsed') {
    return null;
  }

  return (
    <div className="relative z-10 flex min-w-0 items-center justify-between gap-2">
      <LayoutGroup id="composer-tray-chips">
        <div className="flex min-w-0 items-center gap-1.5">
          <Chip
            tone={props.mode === 'agent' ? 'selected' : 'idle'}
            onClick={() => props.onMode('agent')}
          >
            <MagicWandIcon data-icon="inline-start" />
            {modeLabel('agent')}
          </Chip>

          <Chip tone={props.tooling === 'enabled' ? 'selected' : 'idle'} onClick={props.onTools}>
            <PipeWrenchIcon data-icon="inline-start" />
            Tools
          </Chip>

          <Chip
            tone={props.mode === 'compact' ? 'selected' : 'idle'}
            onClick={() => props.onMode('compact')}
          >
            <ListChecksIcon data-icon="inline-start" />
            Compact
          </Chip>
        </div>
      </LayoutGroup>

      <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
        <span>{formatChars(props.chars)}</span>
        <KbdGroup>
          <Kbd className={key}>
            <span className="sr-only">Command</span>
            <CommandIcon />
          </Kbd>
          <Kbd className={key}>K</Kbd>
        </KbdGroup>
      </div>
    </div>
  );
}

function Chip(props: { children: ReactNode; tone: 'idle' | 'selected'; onClick: () => void }) {
  return (
    <motion.button
      className={cn(
        'relative isolate inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-2xl border px-2 text-[11px] font-medium transition-colors duration-150 ease-out-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25',
        props.tone === 'selected'
          ? 'border-white/12 text-foreground'
          : 'border-white/10 bg-white/2.5 text-muted-foreground hover:bg-white/5.5 hover:text-foreground/90',
      )}
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ y: 0, scale: 0.98 }}
      onClick={props.onClick}
    >
      {props.tone === 'selected' ? (
        <motion.span
          layoutId="composer-chip-selected"
          className="absolute inset-0 -z-10 rounded-2xl bg-row-active shadow-[inset_0_1px_0_oklch(1_0_0/8%)]"
          transition={{ duration: 0.18, ease }}
        />
      ) : null}
      {props.children}
    </motion.button>
  );
}

function formatChars(chars: number) {
  if (chars < 1000) {
    return `${chars} chars`;
  }

  return `${(chars / 1000).toFixed(1)}k chars`;
}

const key =
  'size-6 min-w-6 rounded-[0.65rem] border border-white/10 bg-white/[0.045] p-0 text-[12px] text-foreground/75 shadow-[inset_0_1px_0_oklch(1_0_0_/_8%),0_1px_2px_oklch(0_0_0_/_20%)]';

export { ComposerTray };
