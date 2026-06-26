import { motion, useReducedMotion } from 'motion/react';

import { SendIcon, StopIcon } from '~/components/icons';
import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

type ComposerPrimaryActionKind = 'cancel-run' | 'disabled' | 'send-empty' | 'send-ready';

type ComposerPrimaryAction = {
  kind: ComposerPrimaryActionKind;
  label: string;
};

type ButtonVisual = 'disabled' | 'empty' | 'send' | 'stop';

function ComposerPrimaryActionButton(props: {
  action: ComposerPrimaryAction;
  enabled: boolean;
  onCancelRun?: () => void;
}) {
  const reduce = useReducedMotion();
  const visual = visualFromAction(props.action.kind);

  return (
    <motion.button
      aria-label={props.action.label}
      animate={visual}
      className={cn(
        'relative isolate mb-1 grid size-10 shrink-0 place-items-center overflow-hidden rounded-[0.95rem]',
        'border bg-control text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35',
        'disabled:cursor-not-allowed',
      )}
      disabled={!props.enabled}
      title={props.action.label}
      type={props.action.kind === 'send-ready' ? 'submit' : 'button'}
      variants={buttonToneVariants}
      whileHover={props.enabled ? hoverTone(visual) : undefined}
      onClick={
        props.action.kind === 'cancel-run'
          ? () => {
              props.onCancelRun?.();
            }
          : undefined
      }
    >
      <motion.span
        aria-hidden
        animate={{ opacity: stopSurfaceOpacity(visual) }}
        className="absolute inset-0 z-0 bg-danger/15"
        transition={reduce ? instantTransition : surfaceTransition}
      />

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
          <StopIcon className="size-4" />
        </motion.span>
      </span>
    </motion.button>
  );
}

function visualFromAction(kind: ComposerPrimaryActionKind): ButtonVisual {
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

function stopSurfaceOpacity(visual: ButtonVisual) {
  return visual === 'stop' ? 1 : 0;
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
      backgroundColor: 'color-mix(in oklch, var(--canary-danger) 5%, var(--canary-control-hover))',
      borderColor: 'var(--canary-danger)',
      color: 'var(--canary-danger)',
      transition: { duration: 0.16, ease },
    } as const;
  }

  if (visual === 'send') {
    return {
      backgroundColor: 'var(--canary-control-hover)',
      borderColor: 'var(--canary-line-strong)',
      color: 'var(--foreground)',
      transition: { duration: 0.16, ease },
    } as const;
  }

  return {
    backgroundColor: 'var(--canary-control-hover)',
    borderColor: 'var(--canary-line-strong)',
    color: 'var(--foreground)',
    transition: { duration: 0.16, ease },
  } as const;
}

const buttonToneVariants = {
  disabled: {
    backgroundColor: 'var(--canary-control)',
    borderColor: 'var(--canary-line)',
    color: 'var(--muted-foreground)',
    transition: { duration: 0.28, ease },
  },
  empty: {
    backgroundColor: 'var(--canary-control)',
    borderColor: 'var(--canary-line)',
    color: 'var(--muted-foreground)',
    transition: { duration: 0.28, ease },
  },
  send: {
    backgroundColor: 'var(--canary-row)',
    borderColor: 'var(--canary-line)',
    color: 'var(--foreground)',
    transition: { duration: 0.28, ease },
  },
  stop: {
    backgroundColor: 'var(--canary-control-hover)',
    borderColor: 'var(--canary-danger)',
    color: 'var(--canary-danger)',
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

export { ComposerPrimaryActionButton };
