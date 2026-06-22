import type { QueryClient } from '@tanstack/react-query';

import { IconContext } from '@phosphor-icons/react';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { createMiddleware } from '@tanstack/react-start';
import { evlogErrorHandler } from 'evlog/nitro/v3';

import type { orpc } from '~/utils/orpc';

import Header from '~/components/header';
import { ThemeProvider } from '~/components/theme-provider';
import { Toaster } from '~/components/ui/sonner';
import appCss from '~/index.css?url';

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

const tone = { weight: 'duotone' } as const;

export const Route = createRootRouteWithContext<RouterAppContext>()({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },
  component: RootComponent,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'canary',
      },
      {
        name: 'description',
        content: 'canary is a web application',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
      },
    ],
  }),
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          storageKey="canary-ui-theme"
        >
          <IconContext.Provider value={tone}>
            <div className="grid h-svh grid-rows-[auto_1fr]">
              <Header />
              <Outlet />
            </div>
            <Toaster richColors />
          </IconContext.Provider>
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
        <Scripts />
      </body>
    </html>
  );
}
