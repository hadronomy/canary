import type { Shortcut } from "~/app/shortcuts/types";
import { defineShortcuts, shortcut } from "~/app/shortcuts/api";

type HelpHandlers = {
  toggleHelp: () => void;
};

export function createHelpShortcuts(handlers: HelpHandlers): Shortcut[] {
  return defineShortcuts({
    scope: "global",
    category: "Help",
    shortcuts: [shortcut("help.toggle", "Show shortcuts", ["ctrl+h"], () => handlers.toggleHelp())],
  });
}
