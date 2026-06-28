import type { UseHotkeyDefinition } from '@tanstack/react-hotkeys';

import { FunctionIcon } from '@phosphor-icons/react';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import type { Cmd, RunState } from '~/components/composer/commands';
import type {
  AvailabilityState,
  ComposerSurfaceState,
  DraftState,
} from '~/components/composer/state';
import type { TrayVisibility } from '~/components/composer/tray';

import { ComposerAction } from '~/components/composer/action';
import { commands } from '~/components/composer/commands';
import { ComposerEditor } from '~/components/composer/editor';
import { history } from '~/components/composer/history';
import { ComposerMenu } from '~/components/composer/menu';
import {
  auraVariants,
  composerMount,
  ease,
  railSectionVariants,
  surfaceVariants,
} from '~/components/composer/motion';
import {
  action as actionFrom,
  enabled as hotkeyEnabled,
  hint as hintCopy,
  initialUi,
  menu as menuFrom,
  reduce as reduceUi,
  surface as surfaceFrom,
} from '~/components/composer/state';
import { ComposerTray } from '~/components/composer/tray';
import { cn } from '~/lib/utils';

type AgentPromptProps = Omit<ComponentPropsWithoutRef<'form'>, 'children' | 'onSubmit'> & {
  disabled?: boolean;
  error: null | string;
  pristine?: boolean;
  running?: boolean;
  value: string;
  onCancel?: () => void;
  onNew?: () => void;
  onSubmit: (text: string) => void;
  onValue: (text: string) => void;
};

function AgentPrompt({
  'aria-describedby': describedBy,
  className,
  disabled: disabledProp,
  error,
  onCancel,
  onNew,
  onSubmit,
  onValue,
  pristine,
  running,
  value,
  ...props
}: AgentPromptProps) {
  const errorId = useId();
  const hintId = useId();
  const described = [describedBy, error ? errorId : hintId].filter(Boolean).join(' ');

  const reduce = useReducedMotion();
  const hist = useRef(history());
  const composerRef = useRef<HTMLDivElement>(null);

  const [ui, dispatch] = useReducer(reduceUi, initialUi);
  const [hoveringComposer, setHoveringComposer] = useState(false);

  const draftState: DraftState = value.trim() ? 'drafting' : 'empty';
  const runState: RunState = running ? 'running' : 'idle';
  const availability: AvailabilityState = disabledProp ? 'disabled' : 'available';

  const cmds = useMemo(() => commands({ runState }), [runState]);

  const surfaceState = surfaceFrom({
    availability,
    error,
    focus: ui.focus,
    run: runState,
    slash: ui.slash,
  });

  const action = actionFrom({
    availability,
    draft: draftState,
    run: runState,
  });

  const canUsePrimaryAction =
    action.kind === 'cancel-run' ? onCancel !== undefined : action.kind === 'send-ready';

  const placeholder =
    pristine && draftState === 'empty' && ui.focus === 'blurred'
      ? hintCopy(ui.hint)
      : 'Message Canary...';

  const trayVisible =
    hoveringComposer ||
    ui.focus === 'focused' ||
    draftState === 'drafting' ||
    ui.tooling === 'enabled' ||
    ui.mode !== 'agent';

  const trayVisibility: TrayVisibility = trayVisible ? 'expanded' : 'collapsed';
  const trayExpanded = trayVisibility === 'expanded';

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

  const commandHotkeys = useMemo<UseHotkeyDefinition[]>(() => {
    const canUseHotkeys = availability === 'available' && ui.slash.kind === 'closed';

    return cmds.flatMap((cmd) => {
      if (!cmd.key) {
        return [];
      }

      return [
        {
          hotkey: cmd.key,
          callback: (event) => {
            event.preventDefault();
            runCommand(cmd);
          },
          options: {
            enabled:
              canUseHotkeys &&
              hotkeyEnabled(cmd, {
                draft: draftState,
                onCancel,
                onNew,
                run: runState,
              }),
            meta: {
              name: cmd.label,
              description: cmd.desc,
            },
          },
        },
      ];
    });
  }, [availability, cmds, draftState, onCancel, onNew, runCommand, runState, ui.slash.kind]);

  useHotkeys(commandHotkeys, {
    target: composerRef,
    preventDefault: true,
    stopPropagation: true,
    ignoreInputs: false,
    requireReset: true,
    conflictBehavior: 'replace',
  });

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
      aria-describedby={described}
      className={cn(
        'border-t border-line bg-background/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl',
        className,
      )}
      {...props}
      onSubmit={(event) => {
        event.preventDefault();

        if (action.kind === 'send-ready') {
          submit(value);
        }
      }}
    >
      <motion.div
        animate="show"
        className="mx-auto max-w-4xl"
        initial={reduce ? 'reducedHidden' : 'hidden'}
        variants={composerMount}
      >
        <div
          ref={composerRef}
          className="relative isolate overflow-visible"
          onPointerEnter={() => setHoveringComposer(true)}
          onPointerLeave={() => setHoveringComposer(false)}
        >
          <ComposerMenu
            commands={cmds}
            state={menuFrom(ui.slash)}
            onActive={(index) => dispatch({ type: 'slash-active', index })}
            onPick={pickSlashCommand}
          />

          <motion.div
            animate={surfaceState}
            className="relative z-30 isolate overflow-hidden rounded-[1.35rem] border bg-background"
            variants={surfaceVariants}
          >
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent" />

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

              <ComposerAction
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
                  className="relative z-10 border-t border-danger/15 bg-danger/10 px-4 py-2 text-xs text-danger"
                  exit={{ opacity: 0, height: 0, y: -4 }}
                  initial={{ opacity: 0, height: 0, y: -4 }}
                  transition={{ duration: 0.18, ease }}
                >
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </motion.div>

          <motion.div
            aria-hidden={!trayExpanded}
            animate={trayExpanded ? 'open' : 'closed'}
            className={cn(
              'relative z-20 overflow-hidden p-4',
              !trayExpanded && 'pointer-events-none',
            )}
            initial={false}
            variants={railSectionVariants}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-4 -top-px bottom-0 rounded-b-[1.35rem] border-x border-b border-line"
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
        </div>
      </motion.div>
    </form>
  );
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
          'grid size-6 place-items-center rounded-[0.65rem]',
          props.runState === 'running' && 'text-foreground',
        )}
        transition={
          props.runState === 'running'
            ? { duration: 1.6, ease: 'easeInOut', repeat: Number.POSITIVE_INFINITY }
            : { duration: 0.18, ease }
        }
      >
        <FunctionIcon className="size-3.5" />
      </motion.span>
      <span className="truncate">{label}</span>
    </div>
  );
}

export { AgentPrompt };
export type { AgentPromptProps };
