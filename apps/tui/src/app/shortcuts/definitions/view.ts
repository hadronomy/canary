import { defineShortcuts, shortcut } from "../api";
import type { Shortcut } from "../types";

type ViewHandlers = {
  closeCmdk: () => void;
  closeHelp: () => void;
  isCmdkOpen: () => boolean;
  isHelpOpen: () => boolean;
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
    ],
  });
}
