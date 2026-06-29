import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

type CommandSource = 'navigation' | 'recent' | 'thread' | 'workspace';
type CommandTone = 'danger' | 'default';
type CommandScreen = 'account' | 'create-thread' | 'root' | 'theme' | 'threads';

type PageRef =
  | { kind: 'account'; query: string }
  | { kind: 'create-thread'; query: string }
  | { kind: 'rename-thread'; id: string; query: string }
  | { kind: 'root'; query: string }
  | { kind: 'theme'; query: string }
  | { kind: 'threads'; query: string };

type PanelState =
  | { kind: 'actions'; item: string; query: string; selected?: string }
  | { kind: 'list' };

type NonEmptyArray<T> = readonly [T, ...T[]];

type CommandContext = {
  actions: (item?: string) => void;
  close: () => void;
  page: (page: PageRef) => void;
};

type CommandAction = {
  icon: Icon;
  id: string;
  run: (ctx: CommandContext) => Promise<void> | void;
  shortcut?: string;
  title: string;
  tone?: CommandTone;
};

type CommandItem = {
  actions: NonEmptyArray<CommandAction>;
  detail?: ReactNode | ((ctx: CommandContext) => ReactNode);
  icon: Icon;
  id: string;
  keywords: readonly string[];
  primary: CommandAction;
  source: CommandSource;
  subtitle?: string;
  title: string;
};

type CommandSection = {
  id: string;
  items: readonly CommandItem[];
  title: string;
};

type CommandPage = {
  ref: PageRef;
  placeholder: string;
  sections: readonly CommandSection[];
  submit?: CommandAction;
  title: string;
};

type CommandSession = {
  panel: PanelState;
  selected?: string;
  stack: NonEmptyArray<PageRef>;
};

type CommandEvent =
  | { type: 'action-query'; query: string }
  | { type: 'action-select'; id: string }
  | { type: 'back' }
  | { type: 'close-actions' }
  | { type: 'open-actions'; item: string }
  | { type: 'push'; page: PageRef }
  | { type: 'query'; query: string }
  | { type: 'select'; id: string };

type CommandItemInput = Omit<CommandItem, 'actions'> & {
  actions?: readonly CommandAction[];
};

type CommandPageResolver = (state: CommandSession, ctx: CommandContext) => CommandPage;

export type {
  CommandAction,
  CommandContext,
  CommandEvent,
  CommandItem,
  CommandItemInput,
  CommandPage,
  CommandPageResolver,
  CommandScreen,
  CommandSection,
  CommandSession,
  CommandSource,
  CommandTone,
  NonEmptyArray,
  PageRef,
  PanelState,
};
