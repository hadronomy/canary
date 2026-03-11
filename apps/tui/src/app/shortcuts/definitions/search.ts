import type { Shortcut } from '~/app/shortcuts/types';

import { defineShortcuts, shortcut } from '~/app/shortcuts/api';

type SearchHandlers = {
  focusSearch: () => void;
};

export function createSearchShortcuts(handlers: SearchHandlers): Shortcut[] {
  return defineShortcuts({
    scope: 'view',
    category: 'Search',
    shortcuts: [
      shortcut('search.focus', 'Focus search', ['/'], () => handlers.focusSearch(), {
        condition: { disabledIn: ['cmdk', 'dashboard'] },
      }),
    ],
  });
}
