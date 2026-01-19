import type { KeyCombo, Shortcut, ShortcutScope } from "./types";
import { normalizeCombo } from "./helpers";

export type UserRemapping = {
  shortcutId: string;
  bindings: KeyCombo[];
  scope?: ShortcutScope;
};

type RemappingErrorReason = "conflict" | "invalid_key" | "not_remappable" | "not_found";

export type RemappingValidationResult = {
  valid: boolean;
  success: Array<{ shortcutId: string; bindings: KeyCombo[] }>;
  errors: Array<{ shortcutId: string; bindings: KeyCombo[]; reason: RemappingErrorReason }>;
};

export class RemappingRegistry {
  private remappings = new Map<string, UserRemapping>();

  register(shortcuts: Shortcut[], remappings: UserRemapping[]): RemappingValidationResult {
    const results: RemappingValidationResult = { valid: true, success: [], errors: [] };

    for (const remapping of remappings) {
      const target = shortcuts.find((shortcut) => shortcut.id === remapping.shortcutId);
      if (!target) {
        results.valid = false;
        results.errors.push({ ...remapping, reason: "not_found" });
        continue;
      }

      if (target.remappable === false) {
        results.valid = false;
        results.errors.push({ ...remapping, reason: "not_remappable" });
        continue;
      }

      const normalized = remapping.bindings
        .map((binding) => normalizeCombo(binding) || null)
        .filter((binding): binding is KeyCombo => Boolean(binding));

      if (!normalized.length) {
        results.valid = false;
        results.errors.push({ ...remapping, reason: "invalid_key" });
        continue;
      }

      this.remappings.set(remapping.shortcutId, { ...remapping, bindings: normalized });
      results.success.push({ shortcutId: remapping.shortcutId, bindings: normalized });
    }

    return results;
  }

  getEffectiveBindings(shortcut: Shortcut): KeyCombo[] {
    const remap = this.remappings.get(shortcut.id);
    return remap?.bindings ?? shortcut.bindings;
  }

  list() {
    return Array.from(this.remappings.values());
  }
}
