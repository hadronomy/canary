import type { ReactNode } from 'react';

import { useState } from 'react';

import { Caret, Sparkle } from '~/components/agent/glyphs';
import { cn } from '~/lib/utils';

/**
 * What the model thought before it answered.
 *
 * Based on `@beautifului/thinking-state`. The header carries the whole state:
 * a shimmering "Thinking" while the trace is arriving, and how long it took
 * once it is not. A duration is the one thing worth keeping from a finished
 * trace at a glance — everything else is there to be opened.
 *
 * It opens itself while the model is thinking and puts itself away when the
 * model stops, because reasoning is interesting while it is happening and
 * clutter afterwards. Pressing it pins whichever state you chose, so a trace
 * you opened to read does not close under you the moment the run finishes.
 *
 * There is no panel around it. The registry has none either: a bordered card
 * inside a turn reads as a separate message rather than as a footnote to the
 * one being written.
 */

type ReasoningProps = {
  children: ReactNode;
  className?: string;
  /** Seconds spent, for the settled label. Left off while it runs. */
  duration?: number;
  running?: boolean;
};

function Reasoning({ children, className, duration, running = false }: ReasoningProps) {
  // `null` means nobody has pressed it, so the disclosure follows the run.
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = pinned ?? running;

  return (
    <div className={cn('flow-root min-w-0 max-w-full', className)}>
      <button
        aria-expanded={open}
        className={cn(
          '-mx-1.5 flex w-fit max-w-full items-center gap-2 rounded-(--radius-control) py-1 pl-1.5 pr-2',
          'transition-colors duration-(--t-press) ease-out-strong motion-reduce:transition-none',
          'hover:bg-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        )}
        type="button"
        onClick={() => setPinned(!open)}
      >
        <Sparkle
          className={cn(
            'size-4 shrink-0',
            'transition-colors duration-(--t-base) ease-out-strong motion-reduce:transition-none',
            running ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}
        />

        <span
          className={cn(
            'truncate text-[13px] font-medium whitespace-nowrap',
            running ? 'shimmer-text' : 'text-muted-foreground',
          )}
          role="status"
        >
          {running ? 'Thinking' : label(duration)}
        </span>

        <Caret
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground/60 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>

      <div className="t-grow" data-open={open}>
        <div>
          <div className="relative mt-1 ml-[5px] pl-4">
            {/* The guide draws itself open rather than appearing.

                The registry measures the trace and animates the line's height
                to match. That cannot work here: this content streams, so the
                height changes on every token, and the transcript measures every
                one of those frames for its scroll anchoring. Scaling a
                full-height line from its top gets the same stroke, follows the
                content for free, and never asks the browser for a measurement. */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-y-0 left-[3px] w-px origin-top bg-border',
                'transition-transform duration-(--t-slow) ease-out-strong motion-reduce:transition-none',
                open ? 'scale-y-100' : 'scale-y-0',
              )}
            />

            <div className="min-w-0 py-1 pr-1.5 pl-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How long it thought, in words rather than a bare number. */
function label(duration?: number) {
  if (duration === undefined || duration < 1) {
    return 'Thought for a moment';
  }

  const n = Math.round(duration);
  return n === 1 ? 'Thought for 1 second' : `Thought for ${n} seconds`;
}

export { Reasoning };
export type { ReasoningProps };
