import { defineShortcuts, shortcut } from "../api";
import type { Shortcut } from "../types";

type SearchHandlers = {
  focusSearch: () => void;
};

export function createSearchShortcuts(handlers: SearchHandlers): Shortcut[] {
  return defineShortcuts({
    scope: "view",
    category: "Search",
    shortcuts: [
      shortcut("search.focus", "Focus search", ["/"], () => handlers.focusSearch(), {
        condition: { disabledIn: ["cmdk"] },
      }),
    ],
  });
}
