import type { Icon } from '@phosphor-icons/react';

import {
  BrainIcon,
  FileTextIcon,
  FolderSimpleIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';

import { Caret } from '~/components/agent/glyphs';
import { cn } from '~/lib/utils';

/**
 * An agent's tool work, as compact rows under one collapsible header.
 *
 * Based on `@beautifului/tool-chips`, and its measurements are kept: 3px of
 * bleed on a row, 6px on the header, a 28px row holding a 22px chip, and the
 * registry's two radii — 8px on anything that behaves like a control, 6px on
 * the chip nested inside one. Radii step down as they nest, which is what
 * makes the chip read as sitting in the row rather than beside it.
 *
 * The argument chip takes the remaining width rather than hugging its text, so
 * every chip in a run ends on the same right edge. A column of ragged pills
 * reads as a list of unrelated values; one edge reads as a table.
 *
 * The registry reveals its rows on a `setTimeout` because a gallery tile has
 * no run to follow. Here the rows are the run, so they arrive when their
 * events do.
 *
 * Two things are ours. The icon slot trades the tool's mark for a caret on
 * hover, so one slot says "what is this" until you reach for it and "this
 * opens" once you have. And status: a registry demo has no failing tools,
 * while a transcript is mostly read because something failed.
 */

type ToolState = 'pending' | 'running' | 'done' | 'failed';

type ToolStep = {
  /** The argument, shown inline. A path, a command, a query — the one value
   *  that distinguishes this call from the last one. */
  chip?: string;
  /** What the call returned. Absent means there is nothing to open. */
  detail?: string;
  id: string;
  /** Renders the chip and the detail in mono. On for paths and commands, off
   *  for prose, because a sentence set in mono reads as output rather than as
   *  something written. */
  mono?: boolean;
  /** Drives the icon. Matched loosely — a tool called `read_file` and one
   *  called `read` should not look like different kinds of work. */
  name: string;
  status: ToolState;
};

type ToolChipsProps = {
  className?: string;
  defaultOpen?: boolean;
  steps: readonly ToolStep[];
};

const ICONS: readonly (readonly [RegExp, Icon])[] = [
  [/edit|write|patch|apply/, PencilSimpleIcon],
  [/bash|shell|run|exec|command|terminal/, TerminalWindowIcon],
  [/grep|search|find|query/, MagnifyingGlassIcon],
  [/glob|list|dir|folder|tree/, FolderSimpleIcon],
  [/fetch|http|web|browse|url/, GlobeIcon],
  [/think|reason|plan/, BrainIcon],
  [/read|file|cat|view|open/, FileTextIcon],
];

/** The mark for a tool, by name. Falls back rather than guessing wrong. */
function icon(name: string): Icon {
  const key = name.toLowerCase();
  return ICONS.find(([test]) => test.test(key))?.[1] ?? WrenchIcon;
}

function ToolChips({ className, defaultOpen = true, steps }: ToolChipsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const failures = steps.filter((step) => step.status === 'failed').length;

  return (
    /* The registry caps this block at 320px, which is what keeps a stretched
       chip reading as a value rather than as an empty input. Our transcript
       column is more than twice that, so the cap is widened to fit a real
       path and no further. */
    <div className={cn('min-w-0 max-w-lg', className)}>
      <button
        aria-expanded={open}
        className={cn(
          '-mx-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-(--radius-control) py-1 pl-1.5 pr-2',
          'text-[12.5px]/[1.5] text-muted-foreground',
          'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
          'hover:bg-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        )}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <Caret className={cn('size-3', open ? 'rotate-0' : '-rotate-90')} />

        <span className="truncate tabular-nums">
          {steps.length === 1 ? '1 tool call' : `${steps.length} tool calls`}
          {failures ? (
            <span className="text-destructive">
              {failures === 1 ? ' · 1 failed' : ` · ${failures} failed`}
            </span>
          ) : null}
        </span>
      </button>

      <div className="t-grow" data-open={open}>
        <div>
          {/* Wider padding than the pull-back, which sets the rows two pixels
              in from the header and reads as one level of nesting. */}
          <div className="-mx-1 overflow-hidden px-1.5 pb-1">
            <div className="mt-1.5 flex min-w-0 flex-col gap-1">
              {steps.map((step, index) => (
                <Row key={step.id} index={index} step={step} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ index, step }: { index: number; step: ToolStep }) {
  const [open, setOpen] = useState(step.status === 'failed');
  const body = step.detail?.trim();
  const shown = open && !!body;
  const failed = step.status === 'failed';
  const Mark = icon(step.name);

  return (
    <div className="reveal min-w-0" style={{ ['--i' as string]: index }}>
      <button
        aria-expanded={body ? shown : undefined}
        className={cn(
          'group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-(--radius-control) px-[3px] text-left',
          'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          body ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
        )}
        disabled={!body}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <Slot body={!!body} failed={failed} mark={Mark} open={shown} />

        <span
          className={cn(
            'shrink-0 text-[12.5px] font-medium',
            failed ? 'text-destructive' : 'text-foreground',
            step.status === 'pending' && 'text-muted-foreground',
          )}
        >
          {step.name}
        </span>

        {step.chip ? (
          <span
            className={cn(
              'inline-flex h-5.5 min-w-0 flex-1 items-center rounded-sm px-1.5 text-[11.5px]',
              'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
              step.mono && 'font-mono',
              failed
                ? 'bg-destructive/10 text-destructive/90'
                : 'bg-surface-2 text-muted-foreground shadow-surface-1',
            )}
          >
            {/* `min-w-0` is what keeps the right padding: without it this
                cannot shrink under its own text, so it overruns the chip's
                content box and the ellipsis lands on the border instead of
                inside the padding.

                The shimmer goes here and never on the chip, because it clips
                the background to the glyphs — a chip wearing it loses its own
                fill and the row stops looking like a row. */}
            <span className={cn('min-w-0 truncate', step.status === 'running' && 'shimmer-text')}>
              {step.chip}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
      </button>

      <div className="t-grow" data-open={shown}>
        <div>
          {/* The rule is the one thing tying the output to the row above it.
              Indented past the mark so it reads as hanging off that row rather
              than as a sibling of it. */}
          <div
            className={cn(
              'mt-0.5 mb-1 ml-2 flex min-w-0 flex-col border-l py-0.5 pl-3.5',
              failed ? 'border-destructive/30' : 'border-border',
            )}
          >
            <pre
              className={cn(
                'm-0 max-h-72 min-w-0 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6] wrap-anywhere',
                failed ? 'text-destructive/90' : 'text-muted-foreground',
              )}
            >
              {body}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The row's left slot: the tool's mark, or the caret once you reach for it.
 *
 * Both marks are stacked in the same 16px box and cross-faded, so nothing
 * moves and the row never reflows — a caret that appears by taking up space
 * shifts every label beside it.
 */
function Slot({
  body,
  failed,
  mark: Mark,
  open,
}: {
  body: boolean;
  failed: boolean;
  mark: Icon;
  open: boolean;
}) {
  return (
    <span
      className={cn(
        'relative flex size-4 shrink-0 items-center justify-center',
        failed ? 'text-destructive' : 'text-muted-foreground/70',
      )}
    >
      <Mark
        aria-hidden
        className={cn(
          'absolute size-[13px]',
          'transition-opacity duration-(--t-press) motion-reduce:transition-none',
          body && 'group-hover/row:opacity-0 group-focus-visible/row:opacity-0',
          open && 'opacity-0',
        )}
        weight="bold"
      />

      {body ? (
        <Caret
          className={cn(
            'absolute size-3',
            'transition-[opacity,rotate] duration-(--t-fast) ease-out-strong motion-reduce:transition-none',
            'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
            open ? 'rotate-0 opacity-100' : '-rotate-90',
          )}
        />
      ) : null}
    </span>
  );
}

export { ToolChips };
export type { ToolChipsProps, ToolState, ToolStep };
