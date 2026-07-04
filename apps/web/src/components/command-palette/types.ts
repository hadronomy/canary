import type { Icon } from '@phosphor-icons/react';
import type { RegisterableHotkey } from '@tanstack/react-hotkeys';
import type { ReactNode } from 'react';

import type { Brand } from '~/lib/brand';

import { brandValue } from '~/lib/brand';

type PaletteId = Brand<string, 'PaletteId'>;
type PageId = Brand<string, 'PageId'>;
type SectionId = Brand<string, 'SectionId'>;
type ItemId = Brand<string, 'ItemId'>;
type ActionId = Brand<string, 'ActionId'>;
type CommandId = PageId | SectionId | ItemId | ActionId;
type CommandSource = 'navigation' | 'thread' | 'workspace' | (string & {});
type CommandTone = 'danger' | 'default';

type CommandShortcut =
  | RegisterableHotkey
  | {
      hotkey: RegisterableHotkey;
      label?: string;
    };

type PageRef = {
  id: PageId;
  query: string;
};

type PanelState =
  | { kind: 'actions'; item: ItemId; query: string; selected?: ActionId }
  | { kind: 'list' };

type NonEmptyArray<T> = readonly [T, ...T[]];

type CommandContext = {
  actions: (item?: ItemId) => void;
  close: () => void;
  copy: (value: string) => Promise<void>;
  page: (page: PageId, query?: string) => void;
  query: string;
};

type CommandRun = (ctx: CommandContext) => Promise<void> | void;

type CommandAction = {
  hotkey?: RegisterableHotkey;
  icon?: Icon;
  id: ActionId;
  label?: string;
  learn?: boolean;
  run: CommandRun;
  shortcut?: CommandShortcut;
  stay?: boolean;
  submit?: boolean;
  title: string;
  tone?: CommandTone;
};

type CommandDetail = ReactNode | ((ctx: CommandContext) => ReactNode);

type CommandItem = {
  actions: NonEmptyArray<CommandAction>;
  detail?: CommandDetail;
  icon: Icon;
  id: ItemId;
  keywords: readonly string[];
  primary: CommandAction;
  source: CommandSource;
  subtitle?: string;
  title: string;
};

type CommandSection = {
  id: SectionId;
  items: readonly CommandItem[];
  title: string;
};

type CommandPage = {
  id: PageId;
  placeholder: string;
  sections: readonly CommandSection[];
  submit?: CommandAction;
  title: string;
};

type CommandRegistry = {
  actions: Map<ActionId, { action: CommandAction; item: CommandItem }>;
  items: Map<ItemId, CommandItem>;
  pages: Map<PageId, CommandPage>;
  root: PageId;
};

type CommandSession = {
  panel: PanelState;
  selected?: ItemId;
  stack: NonEmptyArray<PageRef>;
};

type CommandEvent =
  | { type: 'action-query'; query: string }
  | { type: 'action-select'; id: ActionId }
  | { type: 'back' }
  | { type: 'close-actions' }
  | { type: 'commit'; keepPanel?: boolean }
  | { type: 'open-actions'; item: ItemId }
  | { type: 'push'; page: PageId; query?: string }
  | { type: 'query'; query: string }
  | { type: 'select'; id: ItemId };

type CommandModuleView = {
  pages?: ReactNode;
  sections?: ReactNode;
};

type CommandModule<TDeps, TData> = {
  id: string;
  kind: 'command-module';
  render: (data: TData, deps: TDeps) => CommandModuleView;
  useData: (deps: TDeps) => TData;
  view: (deps: TDeps) => CommandModuleView;
};

type CommandRoot = {
  id?: PageId;
  placeholder: string;
  title: string;
};

type CommandPaletteConfig<TDeps> = {
  hotkeys?: {
    toggle?: RegisterableHotkey;
  };
  id: PaletteId | string;
  modules: readonly Pick<CommandModule<TDeps, unknown>, 'id' | 'kind' | 'view'>[];
  root: CommandRoot;
};

type CommandPaletteDefinition<TDeps> = CommandPaletteConfig<TDeps> & {
  id: PaletteId;
  root: CommandRoot & { id: PageId };
  compile: (deps: TDeps) => CommandRegistry;
  render: (deps: TDeps) => ReactNode;
};

const ROOT_PAGE = 'root' as PageId;

function paletteId(value: string) {
  return brandValue<string, 'PaletteId'>(value);
}

function pageId(value: string) {
  return brandValue<string, 'PageId'>(value);
}

function sectionId(value: string) {
  return brandValue<string, 'SectionId'>(value);
}

function itemId(value: string) {
  return brandValue<string, 'ItemId'>(value);
}

function actionId(value: string) {
  return brandValue<string, 'ActionId'>(value);
}

export { ROOT_PAGE, actionId, itemId, pageId, paletteId, sectionId };
export type {
  ActionId,
  CommandAction,
  CommandContext,
  CommandDetail,
  CommandEvent,
  CommandId,
  CommandItem,
  CommandModule,
  CommandModuleView,
  CommandPage,
  CommandPaletteConfig,
  CommandPaletteDefinition,
  CommandRegistry,
  CommandRoot,
  CommandRun,
  CommandSection,
  CommandSession,
  CommandShortcut,
  CommandSource,
  CommandTone,
  ItemId,
  NonEmptyArray,
  PageId,
  PageRef,
  PaletteId,
  PanelState,
  SectionId,
};
