import type { RegisterableHotkey } from '@tanstack/react-hotkeys';
import type { ComponentPropsWithoutRef, Dispatch, RefObject } from 'react';

import { createContext, use } from 'react';

import type { CommandUsage } from '~/components/command-palette/learning';
import type {
  CommandAction,
  CommandContext,
  CommandEvent,
  CommandItem,
  CommandPage,
  CommandRegistry,
  CommandSession,
  ItemId,
  PageId,
  PanelState,
} from '~/components/command-palette/types';

import { CommandDialog } from '~/components/ui/command';

type CommandPaletteApi = {
  actions: () => void;
};

type CommandPaletteProps = Omit<
  ComponentPropsWithoutRef<typeof CommandDialog>,
  'children' | 'description' | 'onOpenChange' | 'open' | 'title'
> & {
  api?: RefObject<CommandPaletteApi | null>;
  description?: string;
  initial: PageId;
  onOpenChange: (open: boolean) => void;
  onPage: (page: PageId) => void;
  onReset: (id: ItemId) => void;
  onUse: (id: ItemId, query: string) => void;
  open: boolean;
  registry: CommandRegistry;
  title?: string;
  toggle?: RegisterableHotkey;
  usage: CommandUsage;
};

type CommandValue = {
  back: () => void;
  ctx: CommandContext;
  dispatch: Dispatch<CommandEvent>;
  flat: readonly CommandItem[];
  focus: () => void;
  item: CommandItem | null;
  page: CommandPage;
  panel: PanelState;
  registry: CommandRegistry;
  reset: (id: ItemId) => void;
  run: (item: CommandItem) => void;
  runAction: (item: CommandItem, action: CommandAction) => void;
  state: CommandSession;
  usage: CommandUsage;
};

const CommandCtx = createContext<CommandValue | null>(null);

function useCommand() {
  const ctx = use(CommandCtx);

  if (!ctx) {
    throw new Error('Command palette components must be rendered inside CommandPalette.');
  }

  return ctx;
}

function actionTarget(cmd: CommandValue) {
  return cmd.panel.kind === 'actions' ? (cmd.registry.items.get(cmd.panel.item) ?? null) : null;
}

export { CommandCtx, actionTarget, useCommand };
export type { CommandPaletteApi, CommandPaletteProps, CommandValue };
