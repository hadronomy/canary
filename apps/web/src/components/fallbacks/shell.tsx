import type { ReactNode } from 'react';

import { COMMIT } from 'virtual:commit';

import { cn } from '~/lib/utils';

type Scope = 'page' | 'panel';

type ShellProps = {
  scope?: Scope;
  /** The artifact layer. Absolutely positioned, decorative, never load-bearing. */
  artifact?: ReactNode;
  children: ReactNode;
};

/**
 * The frame both route fallbacks sit in.
 *
 * Panel scope drops the wordmark and the commit: inside the app those are
 * already on screen, and repeating them turns a failed region into a second
 * page competing with the one around it.
 */
function Shell({ scope = 'page', artifact, children }: ShellProps) {
  const page = scope === 'page';

  return (
    <section
      data-scope={scope}
      className={cn(
        'canary-ink group/fb relative isolate grid overflow-hidden',
        page
          ? 'min-h-svh grid-rows-[auto_1fr_auto]'
          : 'h-full min-h-[26rem] grid-rows-[auto_1fr_auto] rounded-lg shadow-[inset_0_0_0_1px_var(--line)]',
      )}
    >
      {artifact}

      <header className={cn('relative z-10', page ? 'px-12 pt-9' : 'px-7 pt-6')}>
        {page ? (
          <span className="text-[14px] tracking-[-0.01em] text-[var(--text)]">canary</span>
        ) : null}
      </header>

      <div
        className={cn('relative z-10 grid place-items-center', page ? 'px-12 py-8' : 'px-7 py-4')}
      >
        <div className="w-full max-w-[30rem]">{children}</div>
      </div>

      <footer
        className={cn(
          'code relative z-10 flex justify-end text-[10px] text-[var(--text-faint)]',
          page ? 'px-12 pb-9' : 'px-7 pb-6',
        )}
      >
        {page ? <span title="Checked-out commit">{COMMIT}</span> : null}
      </footer>
    </section>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="code text-[11px] text-[var(--text-dim)]">{children}</p>;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-5 text-[30px] leading-[1.12] tracking-[-0.028em] text-[var(--text)] group-data-[scope=panel]/fb:text-[24px]">
      {children}
    </h1>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 max-w-[42ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
      {children}
    </p>
  );
}

/** The reference that failed, set the way a citation is set. */
function Ref({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="code mt-6 flex items-baseline gap-3 text-[11px]">
      <span className="shrink-0 text-[var(--text-faint)]">{label}</span>
      <span className="min-w-0 break-all text-[var(--text-dim)]">{children}</span>
    </p>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div>;
}

type ActionProps = {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
};

/**
 * The same control the sign-in button uses: a hairline rect whose fill wipes in
 * from the left. Reusing it is the point — a fallback that invents its own
 * button vocabulary reads as a different product.
 */
function Action({ children, href, onClick, primary }: ActionProps) {
  const inner = (
    <>
      {primary ? (
        <span
          aria-hidden
          className="absolute inset-0 bg-[var(--ink)] transition-[clip-path] duration-300 [clip-path:inset(0_100%_0_0)] ease-[var(--ease-strong)] group-hover/a:[clip-path:inset(0_0_0_0)] group-focus-visible/a:[clip-path:inset(0_0_0_0)]"
        />
      ) : null}
      <span
        className={cn(
          'relative transition-colors duration-200',
          primary
            ? 'text-[var(--text)] group-hover/a:text-[var(--on-ink)]'
            : 'text-[var(--text-dim)]',
        )}
      >
        {children}
      </span>
    </>
  );

  const className = cn(
    'group/a relative grid h-10 place-items-center overflow-hidden rounded-[4px] px-5 text-[13px]',
    'shadow-[inset_0_0_0_1px_var(--line)] transition-[transform,box-shadow] duration-150 ease-out',
    'hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text),transparent_66%)] active:scale-[0.98]',
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/** Developer-only detail. Collapsed, and never in production. */
function Detail({ trace }: { trace: string }) {
  if (!import.meta.env.DEV || !trace) return null;

  return (
    <details className="mt-7">
      <summary className="code cursor-pointer text-[11px] text-[var(--text-faint)] transition-colors duration-150 hover:text-[var(--text-dim)]">
        Stack
      </summary>
      <pre className="code mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[4px] p-3 text-[10px] leading-relaxed text-[var(--text-faint)] shadow-[inset_0_0_0_1px_var(--line)]">
        {trace}
      </pre>
    </details>
  );
}

export { Action, Actions, Detail, Kicker, Note, Ref, Shell, Title };
export type { Scope };
