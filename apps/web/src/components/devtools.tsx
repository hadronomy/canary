import type { QueryClient } from '@tanstack/react-query';

import { TanStackDevtools } from '@tanstack/react-devtools';
import { hotkeysDevtoolsPlugin } from '@tanstack/react-hotkeys-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { useMemo } from 'react';

function Devtools(props: { queryClient: QueryClient }) {
  const plugins = useMemo(
    () => [
      {
        id: 'router',
        name: 'Router',
        render: <TanStackRouterDevtoolsPanel />,
      },
      {
        id: 'query',
        name: 'Query',
        render: <ReactQueryDevtoolsPanel client={props.queryClient} />,
      },
      hotkeysDevtoolsPlugin(),
    ],
    [props.queryClient],
  );

  return (
    <TanStackDevtools
      config={{
        position: 'bottom-right',
        panelLocation: 'bottom',
        hideUntilHover: true,
        openHotkey: ['CtrlOrMeta', 'Shift', 'D'],
        inspectHotkey: ['CtrlOrMeta', 'Shift', 'I'],
      }}
      eventBusConfig={{
        debug: false,
      }}
      plugins={plugins}
    />
  );
}

export { Devtools };
