import type { Shortcut } from "../types";
import { defineShortcuts, shortcut } from "../api";

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
