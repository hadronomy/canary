import { defineShortcuts, shortcut } from "~/app/shortcuts/api";
import type { Shortcut } from "~/app/shortcuts/types";

type ViewHandlers = {
  closeCmdk: () => void;
  closeHelp: () => void;
  isCmdkOpen: () => boolean;
  isHelpOpen: () => boolean;
  closeDashboard: () => void;
  isDashboardOpen: () => boolean;
};

export function createViewShortcuts(handlers: ViewHandlers): Shortcut[] {
  return defineShortcuts({
    scope: "view",
    category: "Navigation",
    shortcuts: [
      shortcut("cmdk.close", "Close command palette", ["escape"], () => handlers.closeCmdk(), {
        condition: { when: () => handlers.isCmdkOpen() },
      }),
      shortcut("help.close", "Close shortcuts help", ["escape"], () => handlers.closeHelp(), {
        condition: { when: () => handlers.isHelpOpen() },
      }),
      shortcut(
        "dashboard.close",
        "Close control center",
        ["escape"],
        () => handlers.closeDashboard(),
        {
          condition: { when: () => handlers.isDashboardOpen() },
        },
      ),
    ],
  });
}
