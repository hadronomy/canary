import type { QueryClient } from '@tanstack/react-query';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { IconContext } from '@phosphor-icons/react';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { evlogErrorHandler } from 'evlog/nitro/v3';

import type { orpc } from '~/utils/orpc';

import { Devtools } from '~/components/devtools';
import { AppError, AppNotFound } from '~/components/fallbacks/route';
import { ThemeProvider } from '~/components/theme-provider';
import { Toaster } from '~/components/ui/sonner';
import { TooltipProvider } from '~/components/ui/tooltip';

import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/mona-sans/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';

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
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
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
    <RootProviders>
      <Outlet />
    </RootProviders>
  );
}

function RootError(props: ErrorComponentProps) {
  const path = useRouterState({
    select: (state) => state.location.href,
  });

  return (
    <RootProviders>
      <AppError {...props} path={path} />
    </RootProviders>
  );
}

function RootNotFound() {
  const path = useRouterState({
    select: (state) => state.location.href,
  });

  return (
    <RootProviders>
      <AppNotFound path={path} />
    </RootProviders>
  );
}

function RootProviders(props: { children: ReactNode }) {
  const ctx = Route.useRouteContext();

  return (
    <>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="canary-ui-theme"
      >
        <IconContext.Provider value={tone}>
          <TooltipProvider>{props.children}</TooltipProvider>

          <Toaster richColors />
        </IconContext.Provider>
      </ThemeProvider>

      <Devtools queryClient={ctx.queryClient} />
    </>
  );
}

function RootDocument(props: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>

      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
