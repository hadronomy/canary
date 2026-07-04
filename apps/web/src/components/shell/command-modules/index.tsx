import type { ShellCommandDeps } from '~/components/shell/command-modules/types';

import { ROOT_PAGE, definePalette } from '~/components/command-palette';
import { navigationModule } from '~/components/shell/command-modules/navigation';
import { threadsModule } from '~/components/shell/command-modules/threads';
import { workspaceModule } from '~/components/shell/command-modules/workspace';

const shellPalette = definePalette<ShellCommandDeps>({
  hotkeys: {
    toggle: 'Mod+K',
  },
  id: 'shell',
  modules: [navigationModule, threadsModule, workspaceModule],
  root: {
    id: ROOT_PAGE,
    placeholder: 'Search Canary...',
    title: 'Command Center',
  },
});

export { shellPalette };
export { currentTheme, sorted } from '~/components/shell/command-modules/utils';
export type {
  ShellCommandDeps,
  ThemeChoice,
  ThreadRecord,
} from '~/components/shell/command-modules/types';
