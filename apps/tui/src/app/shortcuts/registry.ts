import type { KeyEvent } from "@opentui/core";

import { isMatch, parseComboList } from "~/app/shortcuts/helpers";
import { RemappingRegistry } from "~/app/shortcuts/remap";
import type { KeyCombo, Shortcut, ShortcutContext, ShortcutScope } from "~/app/shortcuts/types";

const SCOPES: ShortcutScope[] = ["component", "view", "global"];

type RegisteredShortcut = {
  shortcut: Shortcut;
  bindings: ReturnType<typeof parseComboList>;
};

export class ShortcutRegistry {
  private shortcuts = new Map<string, RegisteredShortcut>();
  private scopes = new Map<ShortcutScope, Set<string>>();
  private remappings = new RemappingRegistry();
  private conflicts = new Map<string, string[]>();

  register(shortcut: Shortcut) {
    const effectiveBindings = this.remappings.getEffectiveBindings(shortcut);
    this.shortcuts.set(shortcut.id, {
      shortcut,
      bindings: parseComboList(effectiveBindings),
    });
    if (!this.scopes.has(shortcut.scope)) {
      this.scopes.set(shortcut.scope, new Set());
    }
    this.scopes.get(shortcut.scope)?.add(shortcut.id);
    this.rebuildConflicts();
  }

  unregister(id: string) {
    const entry = this.shortcuts.get(id);
    if (!entry) return;
    this.shortcuts.delete(id);
    this.scopes.get(entry.shortcut.scope)?.delete(id);
    this.rebuildConflicts();
  }

  list(scope?: ShortcutScope, context?: ShortcutContext) {
    let items = Array.from(this.shortcuts.values()).map((entry) => entry.shortcut);

    if (scope) {
      items = items.filter((shortcut) => shortcut.scope === scope);
    }

    if (context) {
      items = items.filter((shortcut) => this.isActive(shortcut, context));
    }

    return items;
  }

  detectConflicts() {
    return new Map(this.conflicts);
  }

  resolveBinding(shortcutId: string): KeyCombo[] | null {
    const entry = this.shortcuts.get(shortcutId);
    return entry?.shortcut.bindings ?? null;
  }

  applyRemappings(remappings: { shortcutId: string; bindings: KeyCombo[] }[]) {
    const validation = this.remappings.register(
      this.list(),
      remappings.map((remapping) => ({
        shortcutId: remapping.shortcutId,
        bindings: remapping.bindings,
      })),
    );

    this.shortcuts.forEach((entry) => {
      const updated = this.remappings.getEffectiveBindings(entry.shortcut);
      entry.bindings = parseComboList(updated);
    });

    this.rebuildConflicts();
    return validation;
  }

  find(event: KeyEvent, context: ShortcutContext): Shortcut | null {
    let found: { id: string; combo: string } | null = null;

    for (const scope of SCOPES) {
      const ids = this.scopes.get(scope);
      if (!ids) continue;
      for (const id of ids) {
        const entry = this.shortcuts.get(id);
        if (!entry) continue;
        if (!this.isActive(entry.shortcut, context)) continue;
        const matched = entry.bindings.find((binding) => isMatch(binding, event));
        if (matched) {
          found = { id: entry.shortcut.id, combo: matched.raw };
          if (context.onShortcutFired) {
            context.onShortcutFired(entry.shortcut.id, matched.raw);
          }
          break;
        }
      }
      if (found) break;
    }

    if (context.onShortcutDebug) {
      const alt = (event as { option?: boolean }).option;
      const label = event.ctrl
        ? "ctrl"
        : event.meta
          ? "meta"
          : event.shift
            ? "shift"
            : alt
              ? "alt"
              : "";
      const combo = label ? `${label}+${event.name}` : event.name;
      context.onShortcutDebug(combo, Boolean(found));
    }

    return found ? (this.shortcuts.get(found.id)?.shortcut ?? null) : null;
  }

  private rebuildConflicts() {
    const conflicts = new Map<string, string[]>();

    this.shortcuts.forEach((entry) => {
      entry.bindings.forEach((binding) => {
        const signature = `${binding.raw}`;
        const existing = conflicts.get(signature) ?? [];
        conflicts.set(signature, [...existing, entry.shortcut.id]);
      });
    });

    this.conflicts = new Map(Array.from(conflicts.entries()).filter(([, ids]) => ids.length > 1));
  }

  private isActive(shortcut: Shortcut, context: ShortcutContext) {
    const condition = shortcut.condition;
    if (!condition) return true;

    if (condition.requiresFocus && context.focusedComponentId) {
      const required = Array.isArray(condition.requiresFocus)
        ? condition.requiresFocus
        : [condition.requiresFocus];
      if (!required.includes(context.focusedComponentId)) return false;
    }

    if (condition.disabledIn && context.currentView) {
      if (condition.disabledIn.includes(context.currentView)) return false;
    }

    if (condition.when && !condition.when()) return false;

    return true;
  }
}
