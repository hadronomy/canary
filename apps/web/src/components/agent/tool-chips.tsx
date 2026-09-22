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

import { cn } from '~/lib/utils';

/**
 * An agent's tool work, as compact rows under one collapsible header.
 *
 * Based on `@beautifului/tool-chips`. The registry version reveals its rows on
 * a `setTimeout` because a gallery tile has no run to follow; here the rows are
 * the run, so they arrive when their events do.
 *
 * What is kept is the row grammar — a mark, a verb, and the argument in a chip
 * — and the interaction that makes it work: at rest the mark says what kind of
 * tool this was, and on hover or focus it becomes the caret that says the row
 * opens. One slot, answering "what is this" until you reach for it and "what
 * can I do with it" once you have.
 *
 * Status is ours. A registry demo has no failing tools; a transcript is mostly
 * read because something failed, so a failed row is tinted and named rather
 * than being one more grey line.
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
    <div className={cn('min-w-0', className)}>
      <button
        aria-expanded={open}
        className={cn(
          '-mx-2.5 flex w-fit max-w-full items-center gap-1.5 rounded-(--radius-press) px-2.5 py-1.5',
          'text-[12.5px] leading-4 text-muted-foreground',
          'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
          'hover:bg-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        )}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <Chevron className={cn('size-1.5', open ? 'rotate-0' : '-rotate-90')} />

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
          {/* Matches the bleed so the clip box never cuts a row's fill. */}
          <div className="-mx-2.5 mt-1 flex min-w-0 flex-col gap-1 px-2.5 pb-0.5">
            {steps.map((step, index) => (
              <Row key={step.id} index={index} step={step} />
            ))}
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
          'group/row -mx-2.5 flex min-h-7 w-[calc(100%+20px)] min-w-0 items-center gap-2 rounded-(--radius-press) px-2.5 text-left',
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

        {/* The chip is sized by its argument, not by the row. A path in a pill
            stretched across 600px of empty space stops reading as a value and
            starts reading as an input someone forgot to fill in. */}
        {step.chip ? (
          <span
            className={cn(
              'inline-flex h-5.5 min-w-0 shrink items-center overflow-hidden rounded-(--radius-press) px-2 text-[11.5px]',
              'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
              step.mono && 'font-mono',
              failed
                ? 'bg-destructive/10 text-destructive/90'
                : 'bg-surface-2 text-muted-foreground shadow-surface-1',
            )}
          >
            {/* `min-w-0` is what keeps the right padding: without it this
                cannot shrink under its own text, so it overruns the chip's
                content box and gets clipped at the border instead of
                ellipsing inside it.

                The shimmer goes here and never on the chip, because it clips
                the background to the glyphs — a chip wearing it loses its own
                fill and the row stops looking like a row. */}
            <span className={cn('min-w-0 truncate', step.status === 'running' && 'shimmer-text')}>
              {step.chip}
            </span>
          </span>
        ) : null}

        {step.status === 'running' ? <Dots /> : null}

        <span className="min-w-0 flex-1" />
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
        'relative grid size-4 shrink-0 place-items-center',
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
        <Chevron
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

/**
 * A caret whose box is the size of the caret.
 *
 * On the stock 24 grid this glyph inks about half its viewBox. That slack is
 * useful where icons sit in a column and it is what lines them up, but it also
 * means padding beside one does not measure what it says. The viewBox is
 * tightened to the path plus its stroke, so the space around this is the space
 * the class asked for.
 */
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn('transition-transform duration-(--t-fast) ease-out-strong', className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="4.8 4.8 14.4 14.4"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Three dots keeping time, for a call that has not come back yet. */
function Dots() {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[3px] pr-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-[3px] rounded-full bg-muted-foreground/70 motion-safe:animate-pulse"
          style={{ animationDelay: `${i * 160}ms`, animationDuration: '1.1s' }}
        />
      ))}
    </span>
  );
}

export { ToolChips };
export type { ToolChipsProps, ToolState, ToolStep };
