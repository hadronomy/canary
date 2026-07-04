export {
  compileCommandPalette,
  createCommandIds,
  defineCommandModule,
  definePalette,
} from '~/components/command-palette/compiler';
export type { CommandPaletteApi, CommandPaletteProps } from '~/components/command-palette/context';
export { Command } from '~/components/command-palette/dsl';
export { CommandPalette } from '~/components/command-palette/host';
export {
  recordCommandUse,
  resetCommandUse,
  useCommandLearning,
  writeCommandPage,
} from '~/components/command-palette/learning';
export type { CommandPrefs, CommandUsage, CommandUse } from '~/components/command-palette/learning';
export { CommandCard, CommandTrigger } from '~/components/command-palette/parts';
export type { CommandCardProps, CommandTriggerProps } from '~/components/command-palette/parts';
export {
  actionId,
  itemId,
  pageId,
  paletteId,
  ROOT_PAGE,
  sectionId,
} from '~/components/command-palette/types';
export type {
  ActionId,
  CommandAction,
  CommandContext,
  CommandId,
  CommandItem,
  CommandModule,
  CommandModuleView,
  CommandPage,
  CommandPaletteDefinition,
  CommandRegistry,
  CommandShortcut,
  ItemId,
  PageId,
  PaletteId,
  SectionId,
} from '~/components/command-palette/types';
