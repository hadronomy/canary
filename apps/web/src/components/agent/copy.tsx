import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { cn } from '~/lib/utils';

/**
 * Puts a message on the clipboard and says so in the same slot.
 *
 * The copy mark trades places with a check rather than a toast appearing
 * somewhere else: the confirmation lands exactly where the eye already is.
 * The check holds long enough to be read and then quietly goes back, so the
 * button is ready for a second copy without anyone resetting it.
 *
 * Hover is instant. This sits under every reply, and a pointer on its way to
 * the composer crosses a column of them.
 */
function Copy({ className, label = 'Copy', text }: { className?: string; label?: string; text: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) {
      return;
    }

    const timer = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(timer);
  }, [done]);

  return (
    <button
      aria-label={done ? 'Copied' : label}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-(--radius-control) text-muted-foreground',
        'transition-[scale] duration-(--t-press) ease-out-strong active:scale-[0.92] motion-reduce:transition-none',
        'hover:bg-hover hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        className,
      )}
      title={done ? 'Copied' : label}
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setDone(true), () => setDone(false));
      }}
    >
      <span aria-hidden className="t-icon-swap size-4" data-state={done ? 'b' : 'a'}>
        <CopyIcon className="t-icon size-4" data-icon="a" />
        <CheckIcon className="t-icon size-4 text-success" data-icon="b" weight="bold" />
      </span>
    </button>
  );
}

export { Copy };
