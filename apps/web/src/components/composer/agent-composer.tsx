import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useReducer, useRef } from 'react';

import type { Cmd, Mode, RunState } from '~/components/composer/commands';
import type { ComposerSlashState, FocusState } from '~/components/composer/editor';
import type { SlashMenuState } from '~/components/composer/slash-menu';
import type { ToolingState, TrayVisibility } from '~/components/composer/tray';

import { commands } from '~/components/composer/commands';
import { ComposerEditor } from '~/components/composer/editor';
import { history } from '~/components/composer/history';
import { ComposerPrimaryActionButton } from '~/components/composer/primary-action-button';
import { SlashMenu } from '~/components/composer/slash-menu';
import { ComposerTray } from '~/components/composer/tray';
import { AgentIcon } from '~/components/icons';
import { cn } from '~/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

const hints = [
  'Ask Canary to investigate...',
  'Describe the agent task...',
  'Type / for commands...',
  'Ask for the next careful step...',
] as const;

type DraftState = 'empty' | 'drafting';
type AvailabilityState = 'available' | 'disabled';

type ComposerSurfaceState = 'commanding' | 'disabled' | 'error' | 'focused' | 'resting' | 'running';

type ComposerPrimaryAction =
  | { kind: 'cancel-run'; label: string }
  | { kind: 'disabled'; label: string }
  | { kind: 'send-empty'; label: string }
  | { kind: 'send-ready'; label: string };

type ComposerUiState = {
  focus: FocusState;
  hint: number;
  mode: Mode;
  slash: ComposerSlashState;
  tooling: ToolingState;
};

type ComposerUiEvent =
  | { type: 'cycle-hint' }
  | { type: 'focus-change'; focus: FocusState }
  | { type: 'mode-change'; mode: Mode }
  | { type: 'slash-active'; index: number }
  | { type: 'slash-change'; slash: ComposerSlashState }
  | { type: 'tools-toggle' };

const initialUi: ComposerUiState = {
  focus: 'blurred',
  hint: 0,
  mode: 'agent',
  slash: { kind: 'closed' },
  tooling: 'enabled',
};

function AgentComposer(props: {
  disabled?: boolean;
  error: null | string;
  pristine?: boolean;
  running?: boolean;
  value: string;
  onCancel?: () => void;
  onNew?: () => void;
  onSubmit: (text: string) => void;
  onValue: (text: string) => void;
}) {
  const {
    disabled: disabledProp,
    error,
    onCancel,
    onNew,
    onSubmit,
    onValue,
    pristine,
    running,
    value,
  } = props;

  const errorId = useId();
  const hintId = useId();

  const reduce = useReducedMotion();
  const hist = useRef(history());

  const [ui, dispatch] = useReducer(reduceComposerUi, initialUi);

  const draftState: DraftState = value.trim() ? 'drafting' : 'empty';
  const runState: RunState = running ? 'running' : 'idle';
  const availability: AvailabilityState = disabledProp ? 'disabled' : 'available';

  const cmds = useMemo(() => commands({ runState }), [runState]);

  const surfaceState = surfaceFrom({
    availability,
    error,
    focus: ui.focus,
    runState,
    slash: ui.slash,
  });

  const action = primaryAction({
    availability,
    draftState,
    runState,
  });

  const canUsePrimaryAction =
    action.kind === 'cancel-run' ? onCancel !== undefined : action.kind === 'send-ready';

  const placeholder =
    pristine && draftState === 'empty' && ui.focus === 'blurred'
      ? hintCopy(ui.hint)
      : 'Message Canary...';

  const trayVisibility: TrayVisibility =
    ui.focus === 'focused' ||
    draftState === 'drafting' ||
    ui.tooling === 'enabled' ||
    ui.mode !== 'agent'
      ? 'expanded'
      : 'collapsed';

  useEffect(() => {
    if (!pristine || draftState !== 'empty' || ui.focus !== 'blurred') {
      return;
    }

    const timer = window.setInterval(() => {
      dispatch({ type: 'cycle-hint' });
    }, 6500);

    return () => window.clearInterval(timer);
  }, [draftState, pristine, ui.focus]);

  const submit = useCallback(
    (text: string) => {
      const body = text.trim();

      if (!body || availability === 'disabled') {
        return;
      }

      hist.current.push(body);
      onSubmit(body);
    },
    [availability, onSubmit],
  );

  const runCommand = useCallback(
    (cmd: Cmd) => {
      if (cmd.disabled) {
        return;
      }

      if (cmd.act.kind === 'clear') {
        onValue('');
        return;
      }

      if (cmd.act.kind === 'cancel') {
        onCancel?.();
        return;
      }

      if (cmd.act.kind === 'new') {
        onNew?.();
        onValue('');
        return;
      }

      if (cmd.act.kind === 'mode') {
        dispatch({ type: 'mode-change', mode: cmd.act.mode });
        return;
      }

      onValue(cmd.act.text);
    },
    [onCancel, onNew, onValue],
  );

  const moveHistory = useCallback(
    (dir: 'down' | 'up', text: string) => hist.current.step(dir, text),
    [],
  );

  const stopRun = useCallback(() => {
    if (runState !== 'running') {
      return;
    }

    onCancel?.();
  }, [onCancel, runState]);

  const activatePrimaryAction = useCallback(() => {
    if (action.kind === 'cancel-run') {
      stopRun();
    }
  }, [action.kind, stopRun]);

  const pickSlashCommand = useCallback(
    (cmd: Cmd) => {
      if (ui.slash.kind === 'closed') {
        return;
      }

      ui.slash.command(cmd);
    },
    [ui.slash],
  );

  return (
    <form
      aria-describedby={error ? errorId : hintId}
      className="border-t border-white/10 bg-background/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl"
      onSubmit={(event) => {
        event.preventDefault();

        if (action.kind === 'send-ready') {
          submit(value);
        }
      }}
    >
      <LayoutGroup>
        <motion.div
          layout
          animate="show"
          className="mx-auto max-w-4xl"
          initial={reduce ? 'reducedHidden' : 'hidden'}
          variants={composerMount}
        >
          <div className="relative isolate overflow-visible">
            <SlashMenu
              commands={cmds}
              state={slashMenuFrom(ui.slash)}
              onActive={(index) => dispatch({ type: 'slash-active', index })}
              onPick={pickSlashCommand}
            />

            <motion.div
              layout
              animate={surfaceState}
              className="relative z-30 isolate overflow-hidden rounded-[1.35rem] border bg-background shadow-[0_22px_90px_oklch(0_0_0/42%)]"
              variants={surfaceVariants}
            >
              <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-linear-to-r from-transparent via-white/24 to-transparent" />

              <motion.div
                aria-hidden
                className="pointer-events-none absolute -inset-px -z-10 rounded-[inherit]"
                variants={auraVariants}
              />

              <div className="relative z-10 flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2">
                <ComposerStatus runState={runState} surfaceState={surfaceState} />

                <p id={hintId} className="hidden text-[11px] text-muted-foreground sm:block">
                  <span className="text-foreground/70">Enter</span> to send ·{' '}
                  <span className="text-foreground/70">Shift Enter</span> for a new line ·{' '}
                  <span className="text-foreground/70">/</span> for commands
                </p>
              </div>

              <div className="relative z-20 grid min-w-0 grid-cols-[1fr_auto] items-end gap-2 p-2">
                <ComposerEditor
                  commands={cmds}
                  disabled={availability === 'disabled'}
                  placeholder={placeholder}
                  slashState={ui.slash}
                  value={value}
                  onCommand={runCommand}
                  onEscape={runState === 'running' ? stopRun : undefined}
                  onFocusChange={(focus) => dispatch({ type: 'focus-change', focus })}
                  onHistory={moveHistory}
                  onSlashChange={(slash) => dispatch({ type: 'slash-change', slash })}
                  onSubmit={submit}
                  onValue={onValue}
                />

                <ComposerPrimaryActionButton
                  action={action}
                  enabled={canUsePrimaryAction}
                  onCancelRun={activatePrimaryAction}
                />
              </div>

              <AnimatePresence initial={false}>
                {error ? (
                  <motion.p
                    id={errorId}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    className="relative z-10 border-t border-red-400/15 bg-red-500/5.5 px-4 py-2 text-xs text-red-200"
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    transition={{ duration: 0.18, ease }}
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </motion.div>

            <AnimatePresence initial={false}>
              {trayVisibility === 'expanded' ? (
                <motion.div
                  layout
                  animate="open"
                  className="relative z-20 p-4"
                  exit={reduce ? 'reduced' : 'closed'}
                  initial={reduce ? 'reduced' : 'closed'}
                  variants={railSectionVariants}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-4 -top-px bottom-0 rounded-b-[1.35rem] border-x border-b border-white/9.5"
                  />

                  <div className="relative z-10 px-4">
                    <ComposerTray
                      chars={value.length}
                      mode={ui.mode}
                      tooling={ui.tooling}
                      visibility={trayVisibility}
                      onMode={(mode) => dispatch({ type: 'mode-change', mode })}
                      onTools={() => dispatch({ type: 'tools-toggle' })}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      </LayoutGroup>
    </form>
  );
}

function reduceComposerUi(state: ComposerUiState, event: ComposerUiEvent): ComposerUiState {
  if (event.type === 'cycle-hint') {
    return { ...state, hint: (state.hint + 1) % hints.length };
  }

  if (event.type === 'focus-change') {
    return { ...state, focus: event.focus };
  }

  if (event.type === 'mode-change') {
    return {
      ...state,
      mode: event.mode,
      tooling: event.mode === 'tools' ? 'enabled' : state.tooling,
    };
  }

  if (event.type === 'slash-change') {
    return { ...state, slash: event.slash };
  }

  if (event.type === 'slash-active') {
    return { ...state, slash: withSlashActive(state.slash, event.index) };
  }

  return {
    ...state,
    tooling: state.tooling === 'enabled' ? 'disabled' : 'enabled',
  };
}

function withSlashActive(slash: ComposerSlashState, index: number): ComposerSlashState {
  if (slash.kind === 'closed') {
    return slash;
  }

  return {
    ...slash,
    active: Math.max(0, index),
  };
}

function slashMenuFrom(slash: ComposerSlashState): SlashMenuState {
  if (slash.kind === 'closed') {
    return { kind: 'closed' };
  }

  return {
    active: slash.active,
    kind: 'open',
    query: slash.query,
  };
}

function surfaceFrom(input: {
  availability: AvailabilityState;
  error: null | string;
  focus: FocusState;
  runState: RunState;
  slash: ComposerSlashState;
}): ComposerSurfaceState {
  if (input.availability === 'disabled') {
    return 'disabled';
  }

  if (input.error) {
    return 'error';
  }

  if (input.slash.kind === 'open') {
    return 'commanding';
  }

  if (input.runState === 'running') {
    return 'running';
  }

  if (input.focus === 'focused') {
    return 'focused';
  }

  return 'resting';
}

function primaryAction(input: {
  availability: AvailabilityState;
  draftState: DraftState;
  runState: RunState;
}): ComposerPrimaryAction {
  if (input.runState === 'running') {
    return { kind: 'cancel-run', label: 'Stop generation' };
  }

  if (input.availability === 'disabled') {
    return { kind: 'disabled', label: 'Composer unavailable' };
  }

  if (input.draftState === 'empty') {
    return { kind: 'send-empty', label: 'Write a message first' };
  }

  return { kind: 'send-ready', label: 'Send message' };
}

function ComposerStatus(props: { runState: RunState; surfaceState: ComposerSurfaceState }) {
  const label =
    props.surfaceState === 'disabled'
      ? 'Composer paused'
      : props.surfaceState === 'error'
        ? 'Needs attention'
        : props.surfaceState === 'commanding'
          ? 'Command palette'
          : props.runState === 'running'
            ? 'Canary is working'
            : 'Ready';

  return (
    <div className="inline-flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
      <motion.span
        aria-hidden
        animate={props.runState === 'running' ? { opacity: [0.55, 1, 0.55] } : { opacity: 0.8 }}
        className={cn(
          'grid size-6 place-items-center rounded-[0.65rem] border border-white/10 bg-white/4.5',
          props.runState === 'running' && 'text-foreground',
        )}
        transition={
          props.runState === 'running'
            ? { duration: 1.6, ease: 'easeInOut', repeat: Number.POSITIVE_INFINITY }
            : { duration: 0.18, ease }
        }
      >
        <AgentIcon className="size-3.5" />
      </motion.span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function hintCopy(idx: number) {
  return hints[idx] ?? 'Ask Canary to investigate...';
}

const composerMount = {
  hidden: {
    opacity: 0,
    y: 8,
    scale: 0.992,
    filter: 'blur(2px)',
  },
  reducedHidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.22,
      ease,
    },
  },
};

const surfaceVariants = {
  commanding: {
    borderColor: 'oklch(1 0 0 / 0.18)',
    borderTopLeftRadius: '1.18rem',
    borderTopRightRadius: '1.18rem',
    boxShadow: '0 26px 96px oklch(0 0 0 / 0.5), 0 0 0 1px oklch(1 0 0 / 0.04)',
    y: 1,
    transition: { duration: 0.2, ease },
  },
  disabled: {
    borderColor: 'oklch(1 0 0 / 0.075)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: '0 16px 60px oklch(0 0 0 / 0.32)',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  error: {
    borderColor: 'oklch(0.72 0.18 25 / 0.34)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: '0 24px 90px oklch(0.38 0.12 25 / 0.24), 0 22px 80px oklch(0 0 0 / 0.42)',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  focused: {
    borderColor: 'oklch(1 0 0 / 0.18)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: '0 26px 96px oklch(0 0 0 / 0.48), 0 0 0 1px oklch(1 0 0 / 0.03)',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  resting: {
    borderColor: 'oklch(1 0 0 / 0.095)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: '0 22px 90px oklch(0 0 0 / 0.42)',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  running: {
    borderColor: 'oklch(1 0 0 / 0.16)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: '0 24px 96px oklch(0 0 0 / 0.46), 0 22px 90px oklch(0 0 0 / 0.42)',
    y: 0,
    transition: { duration: 0.18, ease },
  },
};

const auraVariants = {
  commanding: {
    opacity: 0.68,
    background: 'linear-gradient(135deg, oklch(1 0 0 / 0.07), transparent 42%)',
  },
  disabled: { opacity: 0 },
  error: {
    opacity: 1,
    background: 'linear-gradient(135deg, oklch(0.64 0.2 25 / 0.12), transparent 38%, transparent)',
  },
  focused: {
    opacity: 0.7,
    background: 'linear-gradient(135deg, oklch(1 0 0 / 0.07), transparent 44%)',
  },
  resting: {
    opacity: 0.45,
    background: 'linear-gradient(135deg, oklch(1 0 0 / 0.045), transparent 42%)',
  },
  running: {
    opacity: 0.65,
    background: 'linear-gradient(135deg, oklch(1 0 0 / 0.065), transparent 42%)',
  },
};

const railSectionVariants = {
  closed: {
    opacity: 0,
    height: 0,
    y: -6,
    filter: 'blur(2px)',
    transition: { duration: 0.14, ease },
  },
  open: {
    opacity: 1,
    height: 'auto',
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.18, ease },
  },
  reduced: {
    opacity: 0,
    height: 0,
  },
};

export { AgentComposer };
