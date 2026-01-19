import type { KeyCombo, Shortcut, ShortcutCondition, ShortcutScope } from "~/app/shortcuts/types";

export type ShortcutDefinition = {
  scope: ShortcutScope;
  category?: string;
  requiresFocus?: string | string[];
  disabledIn?: string[];
  shortcuts: Shortcut[];
};

export function shortcut(
  id: string,
  description: string,
  bindings: KeyCombo[] | readonly KeyCombo[],
  action: Shortcut["action"],
  options?: {
    category?: string;
    condition?: ShortcutCondition;
    scope?: ShortcutScope;
  },
): Shortcut {
  return {
    id,
    scope: options?.scope ?? "global",
    bindings: [...bindings],
    description,
    category: options?.category,
    action,
    condition: options?.condition,
    remappable: true,
  };
}

export function defineShortcuts(definition: ShortcutDefinition): Shortcut[] {
  const { scope, category, requiresFocus, disabledIn, shortcuts } = definition;

  return shortcuts.map((item) => {
    const condition =
      item.condition || requiresFocus || disabledIn
        ? {
            ...item.condition,
            requiresFocus: item.condition?.requiresFocus ?? requiresFocus,
            disabledIn: item.condition?.disabledIn ?? disabledIn,
          }
        : undefined;

    return {
      ...item,
      scope,
      category: item.category ?? category,
      condition,
    };
  });
}
