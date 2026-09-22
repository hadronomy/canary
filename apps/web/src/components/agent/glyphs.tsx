import { cn } from '~/lib/utils';

/**
 * The two marks the agent surfaces draw by hand.
 *
 * Everything else in the app comes from Phosphor, and should. These two do
 * not, for the same reason: at the sizes used here the pack's versions carry
 * detail that turns to mush. Phosphor's caret is a filled triangle that reads
 * as a play button at 12px, and its sparkle has a second accent star that
 * becomes a speck. Both are drawn on the same 24 grid the rest of the set uses,
 * so they sit at the same weight beside it.
 */

/** The disclosure mark. Rotate it with a class; it points down at rest. */
function Caret({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn('transition-transform duration-(--t-fast) ease-out-strong', className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Four points, no accent star. The mark for the model thinking. */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

export { Caret, Sparkle };
