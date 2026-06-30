import type { Icon } from '@phosphor-icons/react';
import type { RegisterableHotkey } from '@tanstack/react-hotkeys';
import type { ReactNode } from 'react';

type CommandId = string;
type CommandPageId = string;
type CommandSource = 'navigation' | 'recent' | 'thread' | 'workspace' | (string & {});
type CommandTone = 'danger' | 'default';

type CommandShortcut =
  | RegisterableHotkey
  | {
      hotkey: RegisterableHotkey;
      label?: string;
    };

type PageRef = {
  id: CommandPageId;
  query: string;
};

type PanelState =
  | { kind: 'actions'; item: CommandId; query: string; selected?: CommandId }
  | { kind: 'list' };

type NonEmptyArray<T> = readonly [T, ...T[]];

type CommandContext = {
  actions: (item?: CommandId) => void;
  close: () => void;
  copy: (value: string) => Promise<void>;
  page: (page: CommandPageId, query?: string) => void;
  query: string;
};

type CommandRun = (ctx: CommandContext) => Promise<void> | void;

type CommandAction = {
  hotkey?: RegisterableHotkey;
  icon?: Icon;
  id: CommandId;
  label?: string;
  run: CommandRun;
  shortcut?: CommandShortcut;
  submit?: boolean;
  title: string;
  tone?: CommandTone;
};

type CommandDetail = ReactNode | ((ctx: CommandContext) => ReactNode);

type CommandSearchDocument = {
  id: CommandId;
  keywords: readonly string[];
  source: CommandSource;
  subtitle?: string;
  title: string;
};

type CommandItem = CommandSearchDocument & {
  actions: NonEmptyArray<CommandAction>;
  detail?: CommandDetail;
  icon: Icon;
  primary: CommandAction;
};

type CommandSection = {
  id: CommandId;
  items: readonly CommandItem[];
  title: string;
};

type CommandPage = {
  id: CommandPageId;
  placeholder: string;
  sections: readonly CommandSection[];
  submit?: CommandAction;
  title: string;
};

type CommandRegistry = {
  actions: Map<CommandId, { action: CommandAction; item: CommandItem }>;
  items: Map<CommandId, CommandItem>;
  pages: Map<CommandPageId, CommandPage>;
  root: CommandPageId;
};

type CommandSession = {
  panel: PanelState;
  selected?: CommandId;
  stack: NonEmptyArray<PageRef>;
};

type CommandEvent =
  | { type: 'action-query'; query: string }
  | { type: 'action-select'; id: CommandId }
  | { type: 'back' }
  | { type: 'close-actions' }
  | { type: 'open-actions'; item: CommandId }
  | { type: 'push'; page: CommandPageId; query?: string }
  | { type: 'query'; query: string }
  | { type: 'select'; id: CommandId };

type CommandModuleView = {
  pages?: ReactNode;
  sections?: ReactNode;
};

type CommandModule<TDeps, TData> = {
  id: CommandId;
  render: (data: TData, deps: TDeps) => CommandModuleView;
  useData: (deps: TDeps) => TData;
};

type CommandModuleEntry<TDeps> = {
  id: CommandId;
  useData?: (deps: TDeps) => unknown;
};

type CommandPaletteConfig<TDeps> = {
  hotkeys?: {
    toggle?: RegisterableHotkey;
  };
  id: CommandId;
  modules: readonly CommandModuleEntry<TDeps>[];
  root?: CommandPageId;
};

export type {
  CommandAction,
  CommandContext,
  CommandDetail,
  CommandEvent,
  CommandId,
  CommandItem,
  CommandModule,
  CommandModuleEntry,
  CommandModuleView,
  CommandPage,
  CommandPageId,
  CommandPaletteConfig,
  CommandRegistry,
  CommandRun,
  CommandSearchDocument,
  CommandSection,
  CommandSession,
  CommandShortcut,
  CommandSource,
  CommandTone,
  NonEmptyArray,
  PageRef,
  PanelState,
};
