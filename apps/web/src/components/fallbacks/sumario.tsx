import type { Scope } from '~/components/fallbacks/shell';

import { LPAC, NEIGHBOURS, PLACE } from '~/components/fallbacks/corpus';
import { cn } from '~/lib/utils';

type Props = { scope?: Scope; path: string; asked: string };

/**
 * 404 · Sumario.
 *
 * Every fragment in the corpus has a place in its document: title, chapter,
 * article. A citation that resolves to nothing still points *somewhere* in that
 * tree, and the useful answer is the tree around it — the articles that are
 * actually there, one click away.
 *
 * So there is no illustration here and nothing to look at but the index. The
 * missing citation takes its row in the order it would have had, set as a blank
 * the way a form leaves a blank, and every row around it is a real link.
 */
function Sumario({ scope = 'page', path, asked }: Props) {
  const page = scope === 'page';

  // The vacancy is inserted in citation order: `21 bis` sorts after 21 and
  // before 22, which is exactly where a reader scanning the index looks for it.
  const base = asked.replace(/\s*bis$/i, '');
  const after = NEIGHBOURS.findIndex((a) => a.n === base);
  const rows = [
    ...NEIGHBOURS.slice(0, after + 1).map((a) => ({ ...a, gap: false })),
    { n: asked, t: '', gap: true },
    ...NEIGHBOURS.slice(after + 1).map((a) => ({ ...a, gap: false })),
  ];

  return (
    <section
      data-scope={scope}
      className={cn(
        'canary-ink relative isolate grid overflow-hidden',
        page
          ? 'min-h-svh grid-rows-[auto_1fr_auto]'
          : 'h-full min-h-[30rem] grid-rows-[auto_1fr_auto] rounded-lg shadow-[inset_0_0_0_1px_var(--line)]',
      )}
    >
      <header className={cn(page ? 'px-12 pt-9' : 'px-7 pt-6')}>
        {page ? <span className="text-[14px] tracking-[-0.01em]">canary</span> : null}
      </header>

      <div className={cn('grid content-center', page ? 'px-12 py-10' : 'px-7 py-6')}>
        {/* Two columns on a wide page: the statement on the left, the index it
            is about on the right. They share a baseline at the top rather than
            each centring on its own, so the eye reads across, not down twice. */}
        <div className="mx-auto grid w-full max-w-[64rem] items-start gap-x-16 gap-y-12 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div>
            <p className="code text-[11px] text-[var(--text-dim)]">404 · sumario</p>
            <h1 className="mt-5 text-[34px] leading-[1.08] tracking-[-0.03em] text-balance">
              Artículo {asked} is not in this law.
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-[var(--text-dim)]">
              The citation points into {LPAC.short}, between articles that exist. The index is
              below, open where it should have been.
            </p>
            <p className="code mt-6 text-[11px] break-all text-[var(--text-faint)]">{path}</p>
          </div>

          <nav aria-label={`Índice de ${LPAC.short}`}>
            {/* Where in the document. Real structure, not decoration: each step
                is the level the corpus stores the fragment under. */}
            <ol className="code flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-faint)]">
              <li className="text-[var(--text-dim)]">{LPAC.short}</li>
              {PLACE.slice(0, -1).map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span aria-hidden>/</span>
                  {p}
                </li>
              ))}
            </ol>

            <ol className="mt-5 border-t border-[var(--line)]">
              {rows.map((r) =>
                r.gap ? (
                  <li
                    key="gap"
                    aria-current="location"
                    className="relative grid grid-cols-[4.5rem_1fr] items-center border-b border-[var(--line)] py-3"
                  >
                    <span className="code pr-5 text-right text-[12px] tabular-nums text-[var(--bad)]">
                      {r.n}
                    </span>
                    {/* A blank to be filled in, not an alert. Hatched like an
                        unused field on a printed form, and bounded by the same
                        rules as every other row so it reads as a row. */}
                    <span className="flex h-6 items-center rounded-[2px] bg-[repeating-linear-gradient(135deg,rgb(233_235_236/0.07)_0_1px,transparent_1px_6px)] px-3">
                      <span className="code text-[11px] text-[var(--text-dim)]">
                        no existe en el texto consolidado
                      </span>
                    </span>
                  </li>
                ) : (
                  <li key={r.n} className="border-b border-[var(--line)]">
                    <a
                      href={`/threads/${LPAC.id}/articulo-${r.n}`}
                      className="group/row grid grid-cols-[4.5rem_1fr_auto] items-baseline py-3 outline-none"
                    >
                      <span className="code pr-5 text-right text-[12px] tabular-nums text-[var(--text-faint)] transition-colors duration-150 group-hover/row:text-[var(--text)] group-focus-visible/row:text-[var(--text)]">
                        {r.n}
                      </span>
                      <span className="text-[14px] text-[var(--text-dim)] transition-colors duration-150 group-hover/row:text-[var(--text)] group-focus-visible/row:text-[var(--text)]">
                        {r.t}
                      </span>
                      {/* The arrow arrives from behind the text rather than
                          sitting there waiting. Nothing lifts: the row changes
                          state, it does not move. */}
                      <svg
                        viewBox="0 0 16 16"
                        aria-hidden
                        className="size-3.5 -translate-x-1 text-[var(--text)] opacity-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-visible/row:translate-x-0 group-focus-visible/row:opacity-100 motion-reduce:transition-none"
                      >
                        <path
                          d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  </li>
                ),
              )}
            </ol>

            <div className="code mt-5 flex gap-6 text-[11px]">
              <a
                href={`/threads/${LPAC.id}`}
                className="text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
              >
                índice completo
              </a>
              <a
                href="/"
                className="text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
              >
                inicio
              </a>
            </div>
          </nav>
        </div>
      </div>

      <footer className={cn(page ? 'px-12 pb-9' : 'px-7 pb-6')} />
    </section>
  );
}

export { Sumario };
