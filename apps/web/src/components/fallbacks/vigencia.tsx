import type { KeyboardEvent, PointerEvent } from 'react';

import { useRef, useState } from 'react';

import type { Scope } from '~/components/fallbacks/shell';

import { ARTICLE, iso, LPAC, spell, stamp } from '~/components/fallbacks/corpus';
import { Action } from '~/components/fallbacks/shell';
import { cn } from '~/lib/utils';

type Props = { scope?: Scope; path: string; asked: string };

const FROM = iso('2012-01-01').getTime();
const TO = iso('2026-12-31').getTime();
const DAY = 86_400_000;

const YEARS = Array.from({ length: 15 }, (_, i) => 2012 + i);

function at(t: number) {
  return new Date(FROM + t * (TO - FROM));
}

function place(date: Date) {
  return Math.min(1, Math.max(0, (date.getTime() - FROM) / (TO - FROM)));
}

/**
 * 404 · Vigencia.
 *
 * Most "not found" in a legal corpus is not a missing document, it is a date.
 * The link asked for article 21 as it stood on some day, and on that day the law
 * did not exist yet. Reporting that as a dead end throws away the one thing the
 * product is actually for.
 *
 * So the page is the instrument that answers it: a time axis, the span the norm
 * is in force, and a head parked on the date that was asked for. Drag it — or use
 * the arrow keys — into the span and the article is there. Nothing is faked: the
 * control is the explanation.
 */
function Vigencia({ scope = 'page', path, asked }: Props) {
  const force = iso(LPAC.force);
  const start = place(force);

  const [t, setT] = useState(() => place(iso(asked)));
  const track = useRef<HTMLDivElement>(null);

  const date = at(t);
  const live = date >= force;

  function seek(clientX: number) {
    const b = track.current?.getBoundingClientRect();
    if (!b?.width) return;
    setT(Math.min(1, Math.max(0, (clientX - b.left) / b.width)));
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(e.clientX);
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seek(e.clientX);
  }

  // A month a press, a year with shift. Home and End go to the edges of the axis,
  // and Enter snaps onto the day the law came into force — the one date on this
  // axis anyone actually wants.
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = ((e.shiftKey ? 365 : 30) * DAY) / (TO - FROM);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? t + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? t - step
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? 1
              : e.key === 'Enter'
                ? start
                : null;
    if (next === null) return;
    e.preventDefault();
    setT(Math.min(1, Math.max(0, next)));
  }

  const page = scope === 'page';

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
      <header
        className={cn('flex items-baseline justify-between', page ? 'px-12 pt-9' : 'px-7 pt-6')}
      >
        {page ? <span className="text-[14px] tracking-[-0.01em]">canary</span> : <span />}
        <span className="code text-[11px] text-[var(--text-faint)]">{LPAC.id}</span>
      </header>

      <div className={cn('grid content-center', page ? 'px-12 py-10' : 'px-7 py-6')}>
        <div className="mx-auto w-full max-w-[52rem]">
          <p className="code text-[11px] text-[var(--text-dim)]">404 · vigencia</p>

          <h1 className="mt-5 max-w-[22ch] text-[34px] leading-[1.08] tracking-[-0.03em] text-balance">
            Nothing was in force on {spell(iso(asked))}.
          </h1>

          <p className="mt-4 max-w-[54ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
            The link asks for article 21 on that date. {LPAC.short} was published later and only
            came into force on {spell(force)}. Move the date into the marked span to read it.
          </p>
          <p className="code mt-5 text-[11px] break-all text-[var(--text-faint)]">{path}</p>

          {/* The instrument. */}
          <div className="mt-14 select-none">
            <div className="code mb-3 flex justify-between text-[10px] text-[var(--text-faint)]">
              <span>vigencia</span>
              <span className="tabular-nums">{stamp(date)}</span>
            </div>

            <div
              ref={track}
              role="slider"
              tabIndex={0}
              aria-label="Fecha de vigencia"
              aria-valuemin={FROM}
              aria-valuemax={TO}
              aria-valuenow={date.getTime()}
              aria-valuetext={`${spell(date)}, ${live ? 'en vigor' : 'sin vigencia'}`}
              onPointerDown={down}
              onPointerMove={move}
              onKeyDown={key}
              className="group/axis relative h-16 cursor-ew-resize touch-none rounded-[2px] outline-none focus-visible:shadow-[0_0_0_1px_var(--line)]"
            >
              {/* Baseline across the whole axis. */}
              <div className="absolute inset-x-0 top-8 h-px bg-[var(--line)]" />

              {/* The span the norm is in force. Open on the right: nothing has
                  repealed it, so the rule runs off the edge of the axis rather
                  than stopping at a date that does not exist. */}
              <div
                className="absolute top-[calc(2rem-1px)] right-0 h-[3px] bg-[var(--text)]"
                style={{ left: `${start * 100}%` }}
              />
              <div
                className="absolute top-3 h-10 w-px bg-[var(--text)]"
                style={{ left: `${start * 100}%` }}
              />
              <span
                className="code absolute top-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-[var(--text-dim)]"
                style={{ left: `${start * 100}%` }}
              >
                en vigor
              </span>

              {/* Year ticks. Every fifth is taller, so the axis can be read at a
                  glance instead of counted. */}
              {YEARS.map((y) => (
                <div
                  key={y}
                  className="absolute top-8"
                  style={{ left: `${place(iso(`${y}-01-01`)) * 100}%` }}
                >
                  <div className={cn('w-px bg-[var(--line)]', y % 5 === 0 ? 'h-3' : 'h-1.5')} />
                  {y % 2 === 0 ? (
                    <span className="code absolute top-4 -translate-x-1/2 text-[10px] tabular-nums text-[var(--text-faint)]">
                      {y}
                    </span>
                  ) : null}
                </div>
              ))}

              {/* The head. Follows the pointer directly: this is a control, and a
                  control that lags behind the hand on a spring feels broken. */}
              <div
                className="pointer-events-none absolute top-1 bottom-1 w-px"
                style={{ left: `${t * 100}%` }}
              >
                <div
                  className={cn(
                    'h-full w-px transition-colors duration-200',
                    live ? 'bg-[var(--text)]' : 'bg-[var(--bad)]',
                  )}
                />
                <div
                  className={cn(
                    'absolute top-[1.625rem] left-1/2 size-[9px] -translate-x-1/2 rotate-45 border transition-[background-color,border-color] duration-200',
                    live
                      ? 'border-[var(--text)] bg-[var(--text)]'
                      : 'border-[var(--bad)] bg-[var(--paper)]',
                  )}
                />
              </div>
            </div>
          </div>

          {/* What that date resolves to. The article is always on the page — out of
              force it is set back as a preview of what the right date gives you,
              so moving the head reveals nothing new, it just brings it forward. */}
          <div className="mt-12">
            <p className="code text-[11px] text-[var(--text-dim)]">
              <span
                className={cn(
                  'transition-colors duration-200',
                  live ? 'text-[var(--text)]' : 'text-[var(--bad)]',
                )}
              >
                {live ? 'en vigor' : 'sin vigencia'}
              </span>{' '}
              · {spell(date)}
            </p>

            <article
              className={cn(
                'mt-4 transition-opacity duration-300 ease-[var(--ease-out-strong)]',
                live ? 'opacity-100' : 'opacity-30',
              )}
            >
              <h2 className="text-[15px] tracking-[-0.01em]">{ARTICLE.heading}</h2>
              {ARTICLE.body.map((p) => (
                <p
                  key={p}
                  className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-[var(--text-dim)]"
                >
                  {p}
                </p>
              ))}
            </article>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Action href={`/threads/${LPAC.id}/articulo-21?vigente=${stamp(date)}`} primary>
              {live ? `Open as of ${stamp(date)}` : 'Open current version'}
            </Action>
            <Action onClick={() => globalThis.history.back()}>Go back</Action>
          </div>
        </div>
      </div>

      <footer
        className={cn(
          'code text-[10px] text-[var(--text-faint)]',
          page ? 'px-12 pb-9' : 'px-7 pb-6',
        )}
      >
        ← → mes · shift año · enter vigor
      </footer>
    </section>
  );
}

export { Vigencia };
