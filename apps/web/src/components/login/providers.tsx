import { useState } from 'react';

/**
 * The social sign-in row.
 *
 * Nothing is wired yet — these are the slots the providers will occupy once
 * they exist. They are not dead controls: pressing one says so rather than
 * doing nothing, because a button that silently ignores you is worse than one
 * that admits it is not ready.
 *
 * Brand geometry is the official artwork from simple-icons (CC0-1.0), not
 * redrawn by hand. The marks themselves stay trademarked by their owners; swap
 * in whatever asset each provider's brand guidelines require when wiring them.
 */
const MARKS = {
  google:
    'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z',
  microsoft:
    'M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z',
  apple:
    'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
} as const;

const PROVIDERS = [
  { id: 'google', name: 'Google' },
  { id: 'microsoft', name: 'Microsoft' },
  { id: 'apple', name: 'Apple' },
] as const;

function Providers() {
  const [note, setNote] = useState('');

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-disabled
            onClick={() => setNote(`Sign-in with ${p.name} is not available yet.`)}
            className="group/p flex h-10 items-center justify-center gap-2 rounded-[4px] text-[12px] text-[var(--text-dim)] shadow-[inset_0_0_0_1px_var(--line)] transition-[color,box-shadow,transform] duration-150 ease-out hover:text-[var(--text)] hover:shadow-[inset_0_0_0_1px_rgb(233_235_236/0.34)] active:scale-[0.98]"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="size-[15px] fill-current opacity-70 transition-opacity duration-150 group-hover/p:opacity-100"
            >
              <path d={MARKS[p.id]} />
            </svg>
            {p.name}
          </button>
        ))}
      </div>

      {/* Grown rather than reserved. A permanently held line for a message
          that only appears on a press leaves a band of dead space above the
          divider for everyone who never presses one. */}
      <div className="t-grow" data-open={Boolean(note)}>
        <div>
          <p role="status" className="code pt-3 text-[11px] text-[var(--text-dim)]">
            {note}
          </p>
        </div>
      </div>
    </div>
  );
}

export { PROVIDERS, Providers };
