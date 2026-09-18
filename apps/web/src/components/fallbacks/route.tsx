import { useRef } from 'react';

import type { Scope } from '~/components/fallbacks/shell';

import { Backdrop } from '~/components/backdrop/backdrop';
import interference from '~/components/backdrop/interference.wgsl';
import { Action, Actions, Note, Ref, Shell, Title } from '~/components/fallbacks/shell';
import { Stack } from '~/components/fallbacks/stack';
import { Wake } from '~/components/fallbacks/wake';

type AppErrorProps = {
  error: unknown;
  info?: {
    componentStack?: string;
  };
  path?: string;
  reset: () => void;
  scope?: Scope;
};

type AppNotFoundProps = Record<string, unknown> & {
  path?: string;
  scope?: Scope;
};

/** The route not-found boundary. */
function AppNotFound(props: AppNotFoundProps) {
  return <Wake scope={props.scope} path={props.path ?? 'unknown route'} />;
}

/**
 * The route error boundary.
 *
 * Retrieval in this product is two readings that agree. When one stops, what is
 * left is the beat between them, and that is the artifact behind this page. It is
 * also the only thing carrying the fault hue besides the marker, because anywhere
 * else the colour stops meaning anything.
 */
function AppError(props: AppErrorProps) {
  const state = useRef({ amp: 0.5 });

  const path = props.path ?? 'unknown route';
  const msg =
    props.error instanceof Error
      ? props.error.message
      : typeof props.error === 'string'
        ? props.error
        : 'The page stopped before it finished loading.';
  const stack = props.error instanceof Error ? props.error.stack : null;
  const trace = [msg, stack, props.info?.componentStack].filter(Boolean).join('\n\n');

  return (
    <Shell scope={props.scope} artifact={<Backdrop shader={interference} state={state} />}>
      <p className="code flex items-center gap-2 text-[11px] text-[var(--bad)]">
        <span aria-hidden className="size-1 rounded-full bg-[var(--bad)]" />
        error
      </p>

      {/* Legal register, and the one thing an error page owes the reader: the
          reader did nothing wrong. */}
      <Title>The fault is ours.</Title>

      <Note>
        This page stopped with an error. Try again. If the error occurs again, copy the stack below.
      </Note>

      {/* The raw message is for whoever fixes it, so it is set as a reference
          rather than as prose the reader has to parse. */}
      <Ref label="message">{msg}</Ref>
      <Ref label="route">{path}</Ref>

      <Actions>
        {/* Re-rendering the boundary is the cheap repair and it keeps whatever
            state the app still holds, so it goes first. A reload is the heavier
            one and is a click away in every browser already. */}
        <Action onClick={props.reset} primary>
          Try again
        </Action>
        <Action onClick={() => globalThis.history.back()}>Go back</Action>
      </Actions>

      <Stack trace={trace} />
    </Shell>
  );
}

export { AppError, AppNotFound };
export type { AppErrorProps, AppNotFoundProps };
