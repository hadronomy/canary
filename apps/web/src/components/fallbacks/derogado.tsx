import type { Scope } from '~/components/fallbacks/shell';

import { fecha, iso, LPAC, LRJPAC } from '~/components/fallbacks/corpus';
import { Action } from '~/components/fallbacks/shell';
import { cn } from '~/lib/utils';

type Props = { scope?: Scope; path: string };

/**
 * 404 · Derogado.
 *
 * A repealed norm is not deleted from the record. The consolidated text keeps it,
 * struck through, with a note in the margin saying what replaced it and when.
 * That is a better answer than "not found", because it is the true one: the page
 * existed, it stopped applying, and here is where the law went.
 *
 * So this fallback is a sheet of that record. Real text from the repealed law,
 * set in a serif column; the requested article struck through; the repeal noted
 * in the margin with a link to its successor. The only motion is the rule being
 * drawn across a heading that is already legible.
 */
function Derogado({ scope = 'page', path }: Props) {
  const page = scope === 'page';
  const repealed = iso(LRJPAC.repealed ?? LPAC.force);

  return (
    <section
      data-scope={scope}
      className={cn(
        'canary-paper relative isolate grid overflow-hidden',
        page
          ? 'min-h-svh place-items-center px-6 py-14'
          : 'h-full min-h-[30rem] place-items-center rounded-lg p-6',
      )}
    >
      {/* The sheet. A real surface lifted off the desk by one tight cast shadow
          on the side away from the light, not a soft glow all round. */}
      <article className="relative w-full max-w-[46rem] bg-[var(--sheet)] px-8 pt-10 pb-12 shadow-[0_1px_0_rgb(22_23_26/0.06),0_14px_28px_-18px_rgb(22_23_26/0.35)] md:px-14 md:pt-12">
        {/* Paper grain as substrate. It sits under the type, never over it —
            grain on top of text reads as a dirty screen, not as stock. */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-[0.07]">
          <filter id="derogado-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#derogado-grain)" />
        </svg>

        {/* Crop marks. They say "this is a sheet cut from something longer",
            which is exactly what a consolidated article is. */}
        {(
          [
            'top-3 left-3',
            'top-3 right-3 rotate-90',
            'bottom-3 right-3 rotate-180',
            'bottom-3 left-3 -rotate-90',
          ] as const
        ).map((c) => (
          <svg
            key={c}
            aria-hidden
            viewBox="0 0 12 12"
            className={cn('absolute size-3 text-[var(--text-faint)]', c)}
          >
            <path d="M0 .5h7M.5 0v7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ))}

        <header className="relative flex items-baseline justify-between gap-6 border-b border-[var(--line)] pb-4">
          <span className="code text-[11px] text-[var(--text-dim)]">{LRJPAC.id}</span>
          <span className="code text-[11px] text-[var(--text-faint)]">texto consolidado</span>
        </header>

        <p className="serif relative mt-6 text-[13px] leading-snug text-[var(--text-dim)] italic">
          {LRJPAC.title}
        </p>

        {/* The margin. On a wide sheet the note hangs in its own column beside
            the struck article, aligned to the heading it annotates; narrow, it
            drops under it. Either way it is the one coloured thing on the page. */}
        <div className="relative mt-10 grid gap-x-8 gap-y-4 md:grid-cols-[1fr_11rem]">
          <div>
            <h1 className="serif text-[30px] leading-[1.1] tracking-[-0.01em] text-[var(--text)]">
              <span className="t-strike">Artículo 42. Obligación de resolver.</span>
            </h1>

            {/* Body in the lighter ink the record uses for text no longer in
                force: still readable, visibly not current. */}
            <div className="serif mt-5 space-y-3 text-[15px] leading-[1.6] text-[var(--text-faint)]">
              <p>
                1. La Administración está obligada a dictar resolución expresa en todos los
                procedimientos y a notificarla cualquiera que sea su forma de iniciación.
              </p>
              <p>
                2. El plazo máximo en el que debe notificarse la resolución expresa será el fijado
                por la norma reguladora del correspondiente procedimiento.
              </p>
            </div>
          </div>

          <aside className="t-note relative md:border-l md:border-[var(--line)] md:pl-5">
            <p className="code text-[10px] tracking-[0.02em] text-[var(--bad)]">derogado</p>
            <p className="serif mt-2 text-[13px] leading-snug text-[var(--text)]">
              Con efectos de {fecha(repealed)}, por la disposición derogatoria única de la{' '}
              {LPAC.short}.
            </p>
            <a
              href={`/threads/${LPAC.id}/articulo-21`}
              className="code group/succ mt-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--text)] underline decoration-[var(--line)] underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-[var(--text)]"
            >
              ver art. 21 {LPAC.short}
            </a>
          </aside>
        </div>

        <footer className="relative mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-5">
          <div>
            <p className="code text-[11px] text-[var(--text-dim)]">404 · derogado</p>
            <p className="code mt-1 text-[11px] break-all text-[var(--text-faint)]">{path}</p>
          </div>
          <div className="flex items-center gap-3">
            <Action href={`/threads/${LPAC.id}/articulo-21`} primary>
              Read the current law
            </Action>
            <Action onClick={() => globalThis.history.back()}>Go back</Action>
          </div>
        </footer>
      </article>
    </section>
  );
}

export { Derogado };
