import { ArrowUpIcon, StopIcon } from '@phosphor-icons/react';
import { MetalFx } from 'metal-fx';
import { useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import type { ComposerActionState } from '~/components/composer/state';

import { cn } from '~/lib/utils';

/**
 * The composer's one action: send, or stop while a run is out.
 *
 * A dark disc in a liquid-metal ring, from Jakub Antalík's `metal-fx`. The
 * ring carries the run state. At rest it holds still, a frozen frame of the
 * material; while the agent works it flows, and that is the whole of the
 * "working" signal in the composer — there is no label for it. It also wakes
 * under the pointer, so a hover gets an answer without a colour change.
 *
 * The shader runs only while the ring is moving. The composer never leaves the
 * screen, so a ring that animated at rest would keep the GPU busy for the
 * whole session to say nothing.
 *
 * The disc is a step lighter than the box it sits on, with a dark hairline
 * between it and the metal: raised, and ringed, rather than a hole cut in the
 * surface.
 */
function ComposerAction(props: {
  action: ComposerActionState;
  enabled: boolean;
  onCancelRun?: () => void;
}) {
  const reduce = useReducedMotion();
  const light = useTheme().resolvedTheme === 'light';
  const [awake, setAwake] = useState(false);
  // A ring that mounts paused never paints, and shows as a bare disc. It runs
  // for a moment first so there is a frame of metal to hold.
  const [warm, setWarm] = useState(true);
  const stop = props.action.kind === 'cancel-run';
  const ready = stop || props.action.kind === 'send-ready';

  useEffect(() => {
    const timer = window.setTimeout(() => setWarm(false), 600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    // The press scales this wrapper rather than the ring's own root, which
    // sets an inline `transition` of its own that would swallow ours.
    <span
      className={cn(
        'inline-flex shrink-0 transition-[scale,opacity] duration-(--t-press) ease-out-strong motion-reduce:transition-none',
        'has-[button:enabled:active]:scale-[0.92]',
        props.action.kind === 'disabled' && 'opacity-50',
      )}
    >
      <MetalFx
        // Keeps the focus ring, which the default normalisation strips along
        // with any border or shadow on the button.
        normalizeHostStyles={false}
        // The halo wanders only while a run is out. At rest it would be a glow
        // behind a button for its own sake.
        disableGlow={!stop}
        paused={!warm && (!!reduce || !(stop || awake))}
        preset="silver"
        // The ring is drawn under the button with its centre punched out, so
        // the disc's colour lives on the ring's root and the button stays
        // clear. Inline because the library's own stylesheet is unlayered and
        // outranks a utility class.
        style={{ background: 'var(--metal-core)', color: 'var(--foreground)' }}
        theme={light ? 'light' : 'dark'}
        variant="circle"
        onPointerEnter={() => setAwake(true)}
        onPointerLeave={() => setAwake(false)}
      >
        <button
          aria-label={props.action.label}
          className={cn(
            'grid size-8 place-items-center rounded-full bg-transparent text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-4)',
            'disabled:cursor-not-allowed',
          )}
          disabled={!props.enabled}
          title={props.action.label}
          type={props.action.kind === 'send-ready' ? 'submit' : 'button'}
          onClick={stop ? () => props.onCancelRun?.() : undefined}
        >
          {/* The arrow dims until there is something to send, rather than the
            disc changing colour: the metal stays the one bright thing. */}
          <span
            aria-hidden
            className={cn(
              't-icon-swap size-4 transition-opacity duration-(--t-base) motion-reduce:transition-none',
              !ready && 'opacity-45',
            )}
            data-state={stop ? 'b' : 'a'}
          >
            <ArrowUpIcon className="t-icon size-4" data-icon="a" weight="bold" />
            <StopIcon className="t-icon size-3 place-self-center" data-icon="b" weight="fill" />
          </span>
        </button>
      </MetalFx>
    </span>
  );
}

export { ComposerAction };
