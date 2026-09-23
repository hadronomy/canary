import type { ReactNode } from 'react';

import { useEffect, useState } from 'react';

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
  /** When the trace began, in epoch milliseconds, for the count while it runs. */
  since?: number;
};

function Reasoning({ children, className, duration, running = false, since }: ReasoningProps) {
  // `null` means nobody has pressed it, so the disclosure follows the run.
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = pinned ?? running;

  return (
    <div className={cn('flow-root min-w-0 max-w-full', className)}>
      <button
        aria-expanded={open}
        className={cn(
          '-mx-1.5 flex w-fit max-w-full items-center gap-2 rounded-(--radius-control) py-1 pl-1.5 pr-2',
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

        {running && since !== undefined ? <Elapsed since={since} /> : null}

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

            <div className="min-w-0 px-1.5 py-1">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The header on its own, for the moment between a run starting and its first
 * part landing.
 *
 * It sits exactly where the reasoning header will, in the same box, so when a
 * trace does arrive nothing moves: the caret appears beside a label that was
 * already there. If the model answers without thinking, the text simply takes
 * its place.
 */
function Thinking({ className }: { className?: string }) {
  const [since] = useState(() => Date.now());

  return (
    <div
      className={cn('-mx-1.5 flex w-fit items-center gap-2 py-1 pl-1.5 pr-2', className)}
      role="status"
    >
      <Sparkle className="size-4 shrink-0 text-muted-foreground" />
      <span className="shimmer-text text-[13px] font-medium whitespace-nowrap">Thinking</span>
      <Elapsed since={since} />
    </div>
  );
}

/**
 * Seconds since `since`, once there are enough of them to be worth saying.
 *
 * Nothing for the first two seconds, so a quick reply never flashes a counter.
 * Tabular figures, so nothing beside it shifts as the digits change.
 */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.floor((now - since) / 1000);

  if (seconds < 2) {
    return null;
  }

  return <span className="text-[12px] tabular-nums text-muted-foreground/70">{seconds}s</span>;
}

/** How long it thought, in words rather than a bare number. */
function label(duration?: number) {
  if (duration === undefined || duration < 1) {
    return 'Thought for a moment';
  }

  const n = Math.round(duration);
  return n === 1 ? 'Thought for 1 second' : `Thought for ${n} seconds`;
}

export { Reasoning, Thinking };
export type { ReasoningProps };
