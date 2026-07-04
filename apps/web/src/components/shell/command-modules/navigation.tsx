import { ArrowRightIcon } from '@phosphor-icons/react';

import type { ShellCommandDeps } from '~/components/shell/command-modules/types';

import {
  Command,
  CommandCard,
  createCommandIds,
  defineCommandModule,
} from '~/components/command-palette';
import { primaryNav } from '~/components/shell/routes';

const ids = createCommandIds('navigation');

const navigationModule = defineCommandModule({
  id: 'navigation',
  useData: () => primaryNav,
  render: (routes, deps: ShellCommandDeps) => ({
    sections: (
      <Command.Section id={ids.section('routes')} title="Go to">
        {routes.map((route) => {
          const active = deps.path === route.to || deps.path.startsWith(`${route.to}/`);
          const Icon = route.icon;

          return (
            <Command.Item
              icon={Icon}
              id={ids.item(route.area)}
              key={route.area}
              keywords={[route.area, route.label, String(route.to)]}
              source="navigation"
              subtitle={active ? 'Current location' : 'Navigate'}
              title={route.label}
            >
              <Command.Detail>
                <CommandCard
                  label="Route"
                  title={route.label}
                  value={active ? 'Current location' : String(route.to)}
                />
              </Command.Detail>

              <Command.Action
                icon={ArrowRightIcon}
                id="open"
                shortcut="Enter"
                run={(ctx) => {
                  ctx.close();
                  return deps.nav({ to: route.to }).catch((err: unknown) => {
                    console.error('Command palette navigation failed.', err);
                  });
                }}
              >
                {active ? 'Stay here' : 'Open'}
              </Command.Action>
            </Command.Item>
          );
        })}
      </Command.Section>
    ),
  }),
});

export { navigationModule };
