import type { ComponentPropsWithoutRef } from 'react';

import {
  ArrowBendUpLeftIcon,
  ArrowClockwiseIcon,
  ChatsIcon,
  HouseIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

import { Button, buttonVariants } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { Elevated, type ElevatedProps } from '~/lib/elevated';
import { cn } from '~/lib/utils';

type RouteFallbackScope = 'page' | 'panel';
type RouteFallbackTone = 'missing' | 'fault';

type RouteFallbackProps = ComponentPropsWithoutRef<'section'> & {
  scope?: RouteFallbackScope;
  tone?: RouteFallbackTone;
};

type RouteFallbackSceneProps = ComponentPropsWithoutRef<'div'>;
type RouteFallbackPanelProps = ElevatedProps;
type RouteFallbackHeaderProps = ComponentPropsWithoutRef<'div'>;
type RouteFallbackCodeProps = ComponentPropsWithoutRef<'span'>;
type RouteFallbackTitleProps = ComponentPropsWithoutRef<'h1'>;
type RouteFallbackDescriptionProps = ComponentPropsWithoutRef<'p'>;
type RouteFallbackPathProps = ComponentPropsWithoutRef<'code'>;
type RouteFallbackActionsProps = ComponentPropsWithoutRef<'div'>;
type RouteFallbackDetailsProps = ComponentPropsWithoutRef<'details'>;

type RouteFallbackLinkProps = ComponentPropsWithoutRef<'a'> & {
  href: string;
};

type RouteFallbackButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  href?: never;
};

type RouteFallbackActionProps = RouteFallbackLinkProps | RouteFallbackButtonProps;

type AppErrorProps = {
  error: unknown;
  info?: {
    componentStack?: string;
  };
  path?: string;
  reset: () => void;
  scope?: RouteFallbackScope;
};

type AppNotFoundProps = Record<string, unknown> & {
  path?: string;
  scope?: RouteFallbackScope;
};

function RouteFallback({
  className,
  scope = 'page',
  tone = 'missing',
  ...props
}: RouteFallbackProps) {
  return (
    <section
      data-slot="route-fallback"
      data-scope={scope}
      data-tone={tone}
      className={cn(
        'group/fallback relative isolate overflow-hidden bg-background text-foreground',
        scope === 'page'
          ? 'canary-shell grid h-svh max-h-svh place-items-center px-5 py-6 md:px-8 md:py-10'
          : 'grid h-full min-h-[34rem] place-items-center p-5 md:p-8',
        className,
      )}
      {...props}
    />
  );
}

function RouteFallbackScene({ className, ...props }: RouteFallbackSceneProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="route-fallback-scene"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      {...props}
    >
      <div className="absolute inset-y-0 left-1/2 w-[min(92rem,calc(100%-2.5rem))] -translate-x-1/2 border-x border-border/45 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--foreground),transparent_96%)_1px,transparent_1px)] bg-[length:8.333%_100%]" />
      {props.children}
    </div>
  );
}

function RouteFallbackPanel({
  className,
  offset = 1,
  shadowLevel = 4,
  ...props
}: RouteFallbackPanelProps) {
  return (
    <Elevated
      data-slot="route-fallback-panel"
      offset={offset}
      shadowLevel={shadowLevel}
      className={cn('relative z-10 rounded-2xl border border-border p-4 md:p-5', className)}
      {...props}
    />
  );
}

function RouteFallbackHeader({ className, ...props }: RouteFallbackHeaderProps) {
  return (
    <div
      data-slot="route-fallback-header"
      className={cn('relative z-10 flex min-w-0 items-center gap-3', className)}
      {...props}
    />
  );
}

function RouteFallbackCode({ className, ...props }: RouteFallbackCodeProps) {
  return (
    <span
      data-slot="route-fallback-code"
      className={cn(
        'font-mono text-xs/relaxed tracking-[0.22em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

function RouteFallbackTitle({ className, ...props }: RouteFallbackTitleProps) {
  return (
    <h1
      data-slot="route-fallback-title"
      className={cn(
        'relative z-10 max-w-5xl font-semibold tracking-[-0.07em] text-balance',
        className,
      )}
      {...props}
    />
  );
}

function RouteFallbackDescription({ className, ...props }: RouteFallbackDescriptionProps) {
  return (
    <p
      data-slot="route-fallback-description"
      className={cn(
        'relative z-10 max-w-[60ch] text-base/7 text-muted-foreground text-pretty md:text-xl/8',
        className,
      )}
      {...props}
    />
  );
}

function RouteFallbackPath({ className, children, ...props }: RouteFallbackPathProps) {
  return (
    <code
      data-slot="route-fallback-path"
      translate="no"
      title={typeof children === 'string' ? children : undefined}
      className={cn(
        'relative z-10 block max-w-full truncate font-mono text-xs/relaxed text-muted-foreground md:text-sm/relaxed',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

function RouteFallbackActions({ className, ...props }: RouteFallbackActionsProps) {
  return (
    <div
      data-slot="route-fallback-actions"
      className={cn('relative z-10 flex flex-col items-stretch gap-3 sm:flex-row', className)}
      {...props}
    />
  );
}

function RouteFallbackAction(props: RouteFallbackActionProps) {
  if (typeof props.href === 'string') {
    const { className, ...link } = props;

    return (
      <a
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-10 rounded-md border border-border bg-background/45 px-4 text-sm font-medium text-foreground shadow-none transition-[background-color,border-color,color,transform] hover:border-foreground/30 hover:bg-hover hover:text-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-foreground/20 active:translate-y-px has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3',
          className,
        )}
        {...link}
      />
    );
  }

  return (
    <Button
      {...props}
      className={cn(
        'h-10 rounded-md border border-border bg-background/45 px-4 text-sm font-medium text-foreground shadow-none transition-[background-color,border-color,color,transform] hover:border-foreground/30 hover:bg-hover hover:text-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-foreground/20 active:translate-y-px has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3',
        props.className,
      )}
      variant="ghost"
    />
  );
}

function RouteFallbackDetails({ className, ...props }: RouteFallbackDetailsProps) {
  return (
    <>
      <Separator />
      <details
        data-slot="route-fallback-details"
        className={cn('w-full pt-4 text-left', className)}
        {...props}
      />
    </>
  );
}

function AppNotFound(props: AppNotFoundProps) {
  const path = props.path ?? 'Unknown route';

  return (
    <RouteFallback scope={props.scope} tone="missing">
      <RouteFallbackScene />

      <div className="relative z-10 grid w-full max-w-7xl grid-cols-12 gap-x-6">
        <div className="col-span-12 md:col-span-10 md:col-start-2 xl:col-span-8 xl:col-start-3">
          <RouteFallbackHeader>
            <RouteFallbackCode>404 // Not found</RouteFallbackCode>
          </RouteFallbackHeader>

          <RouteFallbackTitle className="mt-7 text-[clamp(4.25rem,10vw,9rem)] leading-none group-data-[scope=panel]/fallback:text-[clamp(3.5rem,9vw,6.5rem)]">
            Page not found.
          </RouteFallbackTitle>

          <RouteFallbackDescription className="mt-6">
            The path below does not exist, or it moved while the app was syncing. Choose a recovery
            route and keep going.
          </RouteFallbackDescription>

          <RouteFallbackPath className="mt-4 max-w-[60ch]">{path}</RouteFallbackPath>

          <RouteFallbackActions className="mt-10 flex-wrap">
            <RouteFallbackAction
              className="border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground/90 hover:text-background"
              href="/"
            >
              <HouseIcon aria-hidden="true" data-icon="inline-start" />
              Go home
            </RouteFallbackAction>
            <RouteFallbackAction href="/threads">
              <ChatsIcon aria-hidden="true" data-icon="inline-start" />
              Go to chat
            </RouteFallbackAction>
            <RouteFallbackAction type="button" onClick={() => globalThis.history.back()}>
              <ArrowBendUpLeftIcon aria-hidden="true" data-icon="inline-start" />
              Go back
            </RouteFallbackAction>
          </RouteFallbackActions>
        </div>
      </div>
    </RouteFallback>
  );
}

function AppError(props: AppErrorProps) {
  const path = props.path ?? 'Unknown route';
  const msg =
    props.error instanceof Error
      ? props.error.message
      : typeof props.error === 'string'
        ? props.error
        : 'The route failed while rendering or loading data.';
  const stack = props.error instanceof Error ? props.error.stack : null;
  const trace = [msg, stack, props.info?.componentStack].filter(Boolean).join('\n\n');

  return (
    <RouteFallback scope={props.scope} tone="fault">
      <RouteFallbackScene />

      <div className="relative z-10 grid w-full max-w-7xl grid-cols-12 gap-x-6">
        <div className="col-span-12 md:col-span-10 md:col-start-2 xl:col-span-8 xl:col-start-3">
          <RouteFallbackHeader>
            <RouteFallbackCode>Route // Fault</RouteFallbackCode>
          </RouteFallbackHeader>

          <RouteFallbackTitle className="mt-7 text-[clamp(4.25rem,10vw,9rem)] leading-none group-data-[scope=panel]/fallback:text-[clamp(3.5rem,9vw,6.5rem)]">
            Runtime fault.
          </RouteFallbackTitle>

          <RouteFallbackDescription className="mt-6">
            This route stopped while loading or rendering. Retry first; reload if the fault stays
            pinned.
          </RouteFallbackDescription>

          <RouteFallbackPath className="mt-4 max-w-[60ch]">{path}</RouteFallbackPath>

          <RouteFallbackPanel className="mt-7 max-w-2xl rounded-lg">
            <div className="flex min-w-0 gap-3">
              <WarningCircleIcon
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-destructive"
                size={18}
              />
              <p className="min-w-0 text-sm/relaxed text-muted-foreground break-words">{msg}</p>
            </div>

            {import.meta.env.DEV && trace ? (
              <RouteFallbackDetails>
                <summary className="cursor-default rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/20">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-background/40 p-3 text-[11px]/relaxed text-muted-foreground">
                  {trace}
                </pre>
              </RouteFallbackDetails>
            ) : null}
          </RouteFallbackPanel>

          <RouteFallbackActions className="mt-10 flex-wrap">
            <RouteFallbackAction
              className="border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground/90 hover:text-background"
              type="button"
              onClick={props.reset}
            >
              <ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
              Try again
            </RouteFallbackAction>
            <RouteFallbackAction type="button" onClick={() => globalThis.location.reload()}>
              <ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
              Reload
            </RouteFallbackAction>
            <RouteFallbackAction href="/threads">
              <ChatsIcon aria-hidden="true" data-icon="inline-start" />
              Go to chat
            </RouteFallbackAction>
          </RouteFallbackActions>
        </div>
      </div>
    </RouteFallback>
  );
}

export {
  AppError,
  AppNotFound,
  RouteFallback,
  RouteFallbackAction,
  RouteFallbackActions,
  RouteFallbackCode,
  RouteFallbackDescription,
  RouteFallbackDetails,
  RouteFallbackHeader,
  RouteFallbackPanel,
  RouteFallbackPath,
  RouteFallbackScene,
  RouteFallbackTitle,
};
export type {
  AppErrorProps,
  AppNotFoundProps,
  RouteFallbackActionProps,
  RouteFallbackActionsProps,
  RouteFallbackCodeProps,
  RouteFallbackDescriptionProps,
  RouteFallbackDetailsProps,
  RouteFallbackHeaderProps,
  RouteFallbackPanelProps,
  RouteFallbackPathProps,
  RouteFallbackProps,
  RouteFallbackSceneProps,
  RouteFallbackScope,
  RouteFallbackTitleProps,
  RouteFallbackTone,
};
