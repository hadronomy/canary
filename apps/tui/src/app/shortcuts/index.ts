export { defineShortcuts, shortcut } from "~/app/shortcuts/api";
export {
  useShortcuts,
  useShortcutRegistry,
  useShortcutList,
  getShortcutRegistry,
} from "~/app/shortcuts/hooks";
export {
  formatKeyCombo,
  parseKeyCombo,
  normalizeCombo,
  stringifyComboList,
} from "~/app/shortcuts/helpers";
export type { UserRemapping, RemappingValidationResult } from "~/app/shortcuts/remap";
export { RemappingRegistry } from "~/app/shortcuts/remap";
export type {
  KeyBinding,
  KeyCombo,
  BaseKey,
  Modifier,
  Shortcut,
  ShortcutCondition,
  ShortcutContext,
  ShortcutGroup,
  ShortcutScope,
} from "~/app/shortcuts/types";
