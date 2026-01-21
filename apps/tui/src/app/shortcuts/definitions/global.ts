import type { Shortcut } from "~/app/shortcuts/types";
import { defineShortcuts, shortcut } from "~/app/shortcuts/api";

type GlobalHandlers = {
  toggleCommandPalette: () => void;
  clearSearch: () => void;
  openDashboard: () => void;
  openMain: () => void;
  isDashboardOpen: () => boolean;
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
        condition: { disabledIn: ["cmdk", "help", "dashboard"] },
      }),
      shortcut("dashboard.open", "Open control center", ["ctrl+d"], () => handlers.openDashboard()),
      shortcut("dashboard.home", "Return to search", ["ctrl+g"], () => handlers.openMain(), {
        condition: { when: () => handlers.isDashboardOpen() },
      }),
    ],
  });
}
