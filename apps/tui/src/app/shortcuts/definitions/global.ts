import type { Shortcut } from "~/app/shortcuts/types";
import { defineShortcuts, shortcut } from "~/app/shortcuts/api";

type GlobalHandlers = {
  toggleCommandPalette: () => void;
  clearSearch: () => void;
};

export function createGlobalShortcuts(handlers: GlobalHandlers): Shortcut[] {
  return defineShortcuts({
    scope: "global",
    category: "Navigation",
    shortcuts: [
      shortcut("cmdk.toggle", "Open command palette", ["ctrl+k"], () =>
        handlers.toggleCommandPalette(),
      ),
      shortcut("search.clear", "Clear search", ["escape"], () => handlers.clearSearch(), {
        condition: { disabledIn: ["cmdk", "help"] },
      }),
    ],
  });
}
