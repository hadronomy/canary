import type { Cmd, Mode, RunState } from '~/components/composer/commands';
import type { ComposerSlashState, FocusState } from '~/components/composer/editor';
import type { ComposerMenuState } from '~/components/composer/menu';
import type { ToolingState } from '~/components/composer/tray';

const hints = [
  'Ask Canary to investigate...',
  'Describe the agent task...',
  'Type / for commands...',
  'Ask for the next careful step...',
] as const;

type DraftState = 'empty' | 'drafting';
type AvailabilityState = 'available' | 'disabled';

type ComposerSurfaceState = 'commanding' | 'disabled' | 'error' | 'focused' | 'resting' | 'running';

type ComposerActionState =
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

function enabled(
  cmd: Cmd,
  input: {
    draft: DraftState;
    onCancel?: () => void;
    onNew?: () => void;
    run: RunState;
  },
) {
  if (cmd.disabled) {
    return false;
  }

  if (cmd.act.kind === 'clear') {
    return input.run === 'idle' && input.draft === 'drafting';
  }

  if (cmd.act.kind === 'cancel') {
    return input.run === 'running' && input.onCancel !== undefined;
  }

  if (cmd.act.kind === 'new') {
    return input.onNew !== undefined;
  }

  return true;
}

function reduce(state: ComposerUiState, event: ComposerUiEvent): ComposerUiState {
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
    return { ...state, slash: active(state.slash, event.index) };
  }

  return {
    ...state,
    tooling: state.tooling === 'enabled' ? 'disabled' : 'enabled',
  };
}

function active(slash: ComposerSlashState, index: number): ComposerSlashState {
  if (slash.kind === 'closed') {
    return slash;
  }

  return {
    ...slash,
    active: Math.max(0, index),
  };
}

function menu(slash: ComposerSlashState): ComposerMenuState {
  if (slash.kind === 'closed') {
    return { kind: 'closed' };
  }

  return {
    active: slash.active,
    kind: 'open',
    query: slash.query,
  };
}

function surface(input: {
  availability: AvailabilityState;
  error: null | string;
  focus: FocusState;
  run: RunState;
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

  if (input.run === 'running') {
    return 'running';
  }

  if (input.focus === 'focused') {
    return 'focused';
  }

  return 'resting';
}

function action(input: {
  availability: AvailabilityState;
  draft: DraftState;
  run: RunState;
}): ComposerActionState {
  if (input.run === 'running') {
    return { kind: 'cancel-run', label: 'Stop generation' };
  }

  if (input.availability === 'disabled') {
    return { kind: 'disabled', label: 'Composer unavailable' };
  }

  if (input.draft === 'empty') {
    return { kind: 'send-empty', label: 'Write a message first' };
  }

  return { kind: 'send-ready', label: 'Send message' };
}

function hint(idx: number) {
  return hints[idx] ?? hints[0];
}

export { action, enabled, hint, initialUi, menu, reduce, surface };
export type { AvailabilityState, ComposerActionState, ComposerSurfaceState, DraftState };
