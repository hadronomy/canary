import type { ComponentPropsWithoutRef } from 'react';

import { PaperPlaneTiltIcon as SendIcon, StopIcon } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';

import type { ComposerActionState } from '~/components/composer/state';

import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

type ButtonVisual = 'disabled' | 'empty' | 'send' | 'stop';

type ComposerActionProps = Omit<
  ComponentPropsWithoutRef<typeof motion.button>,
  'animate' | 'children' | 'disabled' | 'onClick' | 'type' | 'variants' | 'whileHover'
> & {
  action: ComposerActionState;
  enabled: boolean;
  onCancelRun?: () => void;
};

function ComposerAction({
  action,
  className,
  enabled,
  onCancelRun,
  title,
  ...props
}: ComposerActionProps) {
  const reduce = useReducedMotion();
  const visual = visualFromAction(action.kind);

  return (
    <motion.button
      aria-label={action.label}
      animate={visual}
      className={cn(
        'relative isolate grid size-9 shrink-0 place-items-center overflow-hidden rounded-full',
        'border bg-muted text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
        'disabled:cursor-not-allowed',
        className,
      )}
      disabled={!enabled}
      title={title ?? action.label}
      type={action.kind === 'send-ready' ? 'submit' : 'button'}
      variants={buttonToneVariants}
      whileHover={enabled ? hoverTone(visual) : undefined}
      whileTap={enabled && !reduce ? { scale: 0.92 } : undefined}
      {...props}
      onClick={
        action.kind === 'cancel-run'
          ? () => {
              onCancelRun?.();
            }
          : undefined
      }
    >
      <motion.span
        aria-hidden
        animate={{ opacity: disabledVeilOpacity(visual) }}
        className="absolute inset-0 z-0 bg-background/12"
        transition={reduce ? instantTransition : surfaceTransition}
      />

      <span className="relative z-10 grid size-4 place-items-center overflow-visible">
        <motion.span
          aria-hidden={visual === 'stop'}
          animate={{
            opacity: sendIconOpacity(visual),
            filter: sendIconFilter(visual),
          }}
          className="absolute inset-0 grid place-items-center"
          transition={reduce ? instantTransition : sendIconTransition(visual)}
        >
          <SendIcon className="size-4" />
        </motion.span>

        <motion.span
          aria-hidden={visual !== 'stop'}
          animate={{
            opacity: stopIconOpacity(visual),
            filter: stopIconFilter(visual),
          }}
          className="absolute inset-0 grid place-items-center"
          transition={reduce ? instantTransition : stopIconTransition(visual)}
        >
          <StopIcon className="size-3.5" weight="fill" />
        </motion.span>
      </span>
    </motion.button>
  );
}

function visualFromAction(kind: ComposerActionState['kind']): ButtonVisual {
  if (kind === 'cancel-run') {
    return 'stop';
  }

  if (kind === 'disabled') {
    return 'disabled';
  }

  if (kind === 'send-empty') {
    return 'empty';
  }

  return 'send';
}

function disabledVeilOpacity(visual: ButtonVisual) {
  return visual === 'disabled' ? 1 : 0;
}

function sendIconOpacity(visual: ButtonVisual) {
  if (visual === 'stop') {
    return 0;
  }

  if (visual === 'disabled') {
    return 0.56;
  }

  if (visual === 'empty') {
    return 0.72;
  }

  return 1;
}

function stopIconOpacity(visual: ButtonVisual) {
  return visual === 'stop' ? 1 : 0;
}

function sendIconFilter(visual: ButtonVisual) {
  return visual === 'stop' ? 'blur(3px)' : 'blur(0px)';
}

function stopIconFilter(visual: ButtonVisual) {
  return visual === 'stop' ? 'blur(0px)' : 'blur(3px)';
}

function sendIconTransition(visual: ButtonVisual) {
  if (visual === 'stop') {
    return {
      duration: 0.26,
      ease,
    } as const;
  }

  return {
    delay: 0.035,
    duration: 0.34,
    ease,
  } as const;
}

function stopIconTransition(visual: ButtonVisual) {
  if (visual === 'stop') {
    return {
      delay: 0.04,
      duration: 0.34,
      ease,
    } as const;
  }

  return {
    duration: 0.26,
    ease,
  } as const;
}

function hoverTone(visual: ButtonVisual) {
  if (visual === 'stop') {
    return {
      backgroundColor: 'color-mix(in oklch, var(--foreground) 86%, var(--background))',
      borderColor: 'color-mix(in oklch, var(--foreground) 86%, var(--background))',
      color: 'var(--background)',
      transition: { duration: 0.16, ease },
    } as const;
  }

  if (visual === 'send') {
    return {
      backgroundColor: 'color-mix(in oklch, var(--primary) 88%, white)',
      borderColor: 'color-mix(in oklch, var(--primary) 88%, white)',
      color: 'var(--primary-foreground)',
      transition: { duration: 0.16, ease },
    } as const;
  }

  return {
    backgroundColor: 'var(--accent)',
    borderColor: 'var(--input)',
    color: 'var(--foreground)',
    transition: { duration: 0.16, ease },
  } as const;
}

const buttonToneVariants = {
  disabled: {
    backgroundColor: 'var(--muted)',
    borderColor: 'var(--border)',
    color: 'var(--muted-foreground)',
    transition: { duration: 0.28, ease },
  },
  empty: {
    backgroundColor: 'var(--muted)',
    borderColor: 'var(--border)',
    color: 'var(--muted-foreground)',
    transition: { duration: 0.28, ease },
  },
  send: {
    backgroundColor: 'var(--primary)',
    borderColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
    transition: { duration: 0.28, ease },
  },
  // Stopping is the one thing to do while a run is out, not a mistake to warn
  // about, so it takes the highest contrast on the page rather than the
  // destructive red, which would read as an error the moment a run begins.
  stop: {
    backgroundColor: 'var(--foreground)',
    borderColor: 'var(--foreground)',
    color: 'var(--background)',
    transition: { duration: 0.28, ease },
  },
};

const surfaceTransition = {
  duration: 0.32,
  ease,
} as const;

const instantTransition = {
  duration: 0,
} as const;

export { ComposerAction };
export type { ComposerActionProps };
