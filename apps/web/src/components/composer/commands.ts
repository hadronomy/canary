import type { ComponentType } from 'react';

import {
  AgentIcon,
  BrainIcon,
  BroomIcon,
  ListChecksIcon,
  MagicWandIcon,
  PipeWrenchIcon,
  QuestionIcon,
  SlidersHorizontalIcon,
  StopIcon,
  TerminalWindowIcon,
} from '~/components/icons';

type Icon = ComponentType<{ className?: string }>;

export type Mode = 'agent' | 'compact' | 'tools';

export type RunState = 'idle' | 'running';

export type Act =
  | { kind: 'cancel' }
  | { kind: 'clear' }
  | { kind: 'insert'; text: string }
  | { kind: 'mode'; mode: Mode }
  | { kind: 'new' };

export type Cmd = {
  act: Act;
  desc: string;
  disabled?: boolean;
  icon: Icon;
  id: string;
  key?: string;
  label: string;
  slash: string;
};

export function commands(opts: { runState: RunState }) {
  return [
    {
      id: 'new',
      slash: 'new',
      label: 'New thread',
      desc: 'Prepare a fresh prompt for a new thread.',
      icon: TerminalWindowIcon,
      key: 'N',
      act: { kind: 'new' },
    },
    {
      id: 'agent',
      slash: 'agent',
      label: 'Agent mode',
      desc: 'Bias the response toward autonomous agent work.',
      icon: AgentIcon,
      act: { kind: 'mode', mode: 'agent' },
    },
    {
      id: 'tools',
      slash: 'tools',
      label: 'Use tools',
      desc: 'Prefer tool use when it improves confidence.',
      icon: PipeWrenchIcon,
      act: { kind: 'mode', mode: 'tools' },
    },
    {
      id: 'compact',
      slash: 'compact',
      label: 'Compact',
      desc: 'Ask for a tighter, high-signal answer.',
      icon: BrainIcon,
      act: { kind: 'mode', mode: 'compact' },
    },
    {
      id: 'plan',
      slash: 'plan',
      label: 'Plan first',
      desc: 'Ask Canary for the smallest safe execution plan.',
      icon: ListChecksIcon,
      act: {
        kind: 'insert',
        text: 'Plan this carefully first. Give me the smallest safe sequence of steps, then execute only the first useful step: ',
      },
    },
    {
      id: 'investigate',
      slash: 'investigate',
      label: 'Investigate',
      desc: 'Ask Canary to inspect the problem before changing anything.',
      icon: MagicWandIcon,
      act: {
        kind: 'insert',
        text: 'Investigate this carefully. Identify the likely root cause, the evidence, and the smallest fix: ',
      },
    },
    {
      id: 'model',
      slash: 'model',
      label: 'Model',
      desc: 'Ask Canary to switch or explain the model.',
      icon: SlidersHorizontalIcon,
      act: { kind: 'insert', text: 'Use the current model and explain the tradeoffs: ' },
    },
    {
      id: 'clear',
      slash: 'clear',
      label: 'Clear composer',
      desc: 'Remove the current draft.',
      icon: BroomIcon,
      key: 'Esc',
      act: { kind: 'clear' },
    },
    {
      id: 'cancel',
      slash: 'cancel',
      label: 'Cancel run',
      desc: 'Stop the currently running agent.',
      icon: StopIcon,
      disabled: opts.runState !== 'running',
      key: 'Esc',
      act: { kind: 'cancel' },
    },
    {
      id: 'help',
      slash: 'help',
      label: 'Help',
      desc: 'Show the available composer commands.',
      icon: QuestionIcon,
      act: { kind: 'insert', text: 'Show me what you can do in this workspace.' },
    },
  ] satisfies Cmd[];
}

export function filter(cmds: Cmd[], query: string) {
  const term = query.trim().toLowerCase();

  if (!term) {
    return cmds;
  }

  return cmds.filter((cmd) =>
    [cmd.slash, cmd.label, cmd.desc].some((part) => part.toLowerCase().includes(term)),
  );
}

export function modeLabel(mode: Mode) {
  if (mode === 'tools') {
    return 'Tools';
  }

  if (mode === 'compact') {
    return 'Compact';
  }

  return 'Agent';
}

export { ListChecksIcon, MagicWandIcon };
