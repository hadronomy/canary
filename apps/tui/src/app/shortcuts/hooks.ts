import { useEffect, useMemo, useRef } from "react";
import { useKeyboard } from "@opentui/react";

import type { KeyEvent } from "@opentui/core";
import { ShortcutRegistry } from "./registry";
import type { Shortcut, ShortcutContext } from "./types";

const registry = new ShortcutRegistry();

export function useShortcuts(shortcuts: Shortcut[], options?: { disabled?: boolean }) {
  const disabled = options?.disabled;

  useEffect(() => {
    if (disabled) return;

    shortcuts.forEach((shortcut) => registry.register(shortcut));

    return () => {
      shortcuts.forEach((shortcut) => registry.unregister(shortcut.id));
    };
  }, [shortcuts, disabled]);
}

export function useShortcutRegistry(context: ShortcutContext) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useKeyboard((event: KeyEvent) => {
    const shortcut = registry.find(event, contextRef.current);
    if (!shortcut) return;
    shortcut.action(event);
  });
}

export function useShortcutList(context?: ShortcutContext) {
  return useMemo(() => registry.list(undefined, context), [context]);
}

export function getShortcutRegistry() {
  return registry;
}
