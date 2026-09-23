import type { UseHotkeyDefinition } from '@tanstack/react-hotkeys';

import { WarningCircleIcon } from '@phosphor-icons/react';
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
} from 'react';

import type { Cmd, RunState } from '~/components/composer/commands';
import type { AvailabilityState, DraftState } from '~/components/composer/state';

import { ComposerAction } from '~/components/composer/action';
import { commands } from '~/components/composer/commands';
import { ComposerEditor } from '~/components/composer/editor';
import { history } from '~/components/composer/history';
import { ComposerMenu } from '~/components/composer/menu';
import { composerMount, ease, surfaceVariants } from '~/components/composer/motion';
import {
  action as actionFrom,
  enabled as hotkeyEnabled,
  hint as hintCopy,
  initialUi,
  menu as menuFrom,
  reduce as reduceUi,
  surface as surfaceFrom,
} from '~/components/composer/state';
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
      className={cn('px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2', className)}
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
        <div ref={composerRef} className="relative overflow-visible">
          {/* Read to screen readers with the field; sighted users get the same
              keys from the slash menu and the placeholder. */}
          <p id={hintId} className="sr-only">
            Enter to send, Shift Enter for a new line, slash for commands.
          </p>

          {/* An error rises out from behind the box's top edge as a tab, and
              sinks back into it when it clears. Inset by the box's own 24px
              radius, so its sides land on the straight run of the edge rather
              than on the curve; its 12px corners have 12px of padding inside
              them, so the text never meets a curve. The last 12px tuck behind
              the box. The height grows from the bottom, which is what makes it
              read as coming out of the box rather than dropping onto it.

              It steps aside while the slash menu is open, since the menu takes
              the same edge. */}
          <AnimatePresence initial={false}>
            {error && ui.slash.kind !== 'open' ? (
              <motion.div
                key="error"
                animate={{ height: 'auto', marginBottom: -12, opacity: 1 }}
                className="relative z-20 mx-6 flex flex-col justify-end overflow-hidden"
                exit={{
                  height: 0,
                  marginBottom: 0,
                  opacity: 0,
                  transition: { duration: 0.16, ease },
                }}
                initial={
                  reduce
                    ? { height: 'auto', marginBottom: -12, opacity: 0 }
                    : { height: 0, marginBottom: 0, opacity: 0 }
                }
                transition={{ duration: 0.26, ease }}
              >
                <p
                  id={errorId}
                  className="canary-error-tab flex min-w-0 items-center gap-1.5 rounded-t-[12px] border border-b-0 px-3 pt-1.5 pb-[18px] text-[12.5px]/5 text-destructive"
                  role="alert"
                  title={error}
                >
                  <WarningCircleIcon aria-hidden className="size-3.5 shrink-0" weight="bold" />
                  <span className="truncate">{error}</span>
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* The menu anchors to the box, so it docks onto the box's top edge. */}
          <div className="relative">
            <ComposerMenu
              commands={cmds}
              state={menuFrom(ui.slash)}
              onActive={(index) => dispatch({ type: 'slash-active', index })}
              onPick={pickSlashCommand}
            />

            <motion.div
              animate={surfaceState}
              className="canary-composer relative z-30 overflow-hidden rounded-(--radius-composer) border"
              data-focus={ui.focus}
              data-state={surfaceState}
              variants={surfaceVariants}
            >
              {/* One inset on every side. The send button's 16px radius plus
                  this 8px is the box's 24px, so its corner and the box's share
                  a centre; the text sits a further 10px in. */}
              <div className="relative z-20 grid min-w-0 p-2">
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

                {/* Kept clear for the controls that belong here: model and mode
                    pickers sit left of the send button as they arrive. */}
                <div className="flex min-h-8 min-w-0 items-center justify-end gap-3">
                  <ComposerAction
                    action={action}
                    enabled={canUsePrimaryAction}
                    onCancelRun={activatePrimaryAction}
                  />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </form>
  );
}

export { AgentPrompt };
export type { AgentPromptProps };
