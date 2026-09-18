import type { ReactNode } from 'react';

import { Link, createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { Derogado } from '~/components/fallbacks/derogado';
import { AppError, AppNotFound } from '~/components/fallbacks/route';
import { Sumario } from '~/components/fallbacks/sumario';
import {
  MissingUncited,
  MissingVoid,
  MissingWakeHalftone,
  MissingWakeLens,
  MissingWakeSilk,
  MissingWakeStrata,
} from '~/components/fallbacks/variants';
import { Vigencia } from '~/components/fallbacks/vigencia';

// Preview-only. Delete this route once a direction is picked.
export const Route = createFileRoute('/design/fallback')({
  validateSearch: z.object({
    v: z.coerce.string().optional(),
    scope: z.coerce.string().optional(),
  }),
  component: Preview,
});

type Scope = 'page' | 'panel';

// Each of these answers a different reason a legal citation fails to resolve, so
// each gets the link that would actually produce it.
const CORPUS: readonly (readonly [string, string, (scope: Scope) => ReactNode])[] = [
  [
    'vigencia',
    'Vigencia',
    (scope) => (
      <Vigencia
        scope={scope}
        asked="2014-01-01"
        path="/threads/BOE-A-2015-10565/articulo-21?vigente=2014-01-01"
      />
    ),
  ],
  [
    'sumario',
    'Sumario',
    (scope) => (
      <Sumario scope={scope} asked="21 bis" path="/threads/BOE-A-2015-10565/articulo-21-bis" />
    ),
  ],
  [
    'derogado',
    'Derogado',
    (scope) => <Derogado scope={scope} path="/threads/BOE-A-1992-26318/articulo-42" />,
  ],
];

const MISSING = [
  ['void', 'Void', MissingVoid],
  ['uncited', 'Uncited', MissingUncited],
  ['wake', 'Wake', AppNotFound],
  ['halftone', 'Halftone', MissingWakeHalftone],
  ['silk', 'Silk', MissingWakeSilk],
  ['lens', 'Lens', MissingWakeLens],
  ['strata', 'Strata', MissingWakeStrata],
] as const;

const FAULT = [['interference', 'Interference', AppError]] as const;

const PATH = '/threads/BOE-A-2015-10565/articulo-21?vigente=2014-01-01';
const MESSAGE = 'Cannot read properties of undefined (reading "fragments")';
const TRACE =
  'TypeError: Cannot read properties of undefined (reading "fragments")\n    at Thread (src/routes/_auth/threads/$threadId.tsx:88:21)\n    at renderWithHooks (react-dom.development.js:15486:18)';

function Preview() {
  const search = Route.useSearch();
  const scope = search.scope === 'panel' ? 'panel' : 'page';
  const pick = search.v ?? 'vigencia';

  // Bound to capitalised locals because JSX will not take a member expression
  // as a component.
  const Missing = MISSING.find((m) => m[0] === pick)?.[2];
  const Fault = FAULT.find((f) => f[0] === pick)?.[2];
  const corpus = CORPUS.find((c) => c[0] === pick)?.[2];

  return (
    <div className={scope === 'panel' ? 'canary-ink grid min-h-svh place-items-center p-10' : ''}>
      <div className={scope === 'panel' ? 'h-[32rem] w-full max-w-3xl' : ''}>
        {corpus ? corpus(scope) : null}
        {Missing ? <Missing scope={scope} path={PATH} /> : null}
        {Fault ? (
          <Fault
            scope={scope}
            path={PATH}
            error={Object.assign(new Error(MESSAGE), { stack: TRACE })}
            reset={() => {}}
          />
        ) : null}
      </div>
      <Picker pick={pick} scope={scope} />
    </div>
  );
}

function Picker({ pick, scope }: { pick: string; scope: string }) {
  return (
    <nav className="code fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/80 px-2 py-1.5 text-[11px] shadow-[inset_0_0_0_1px_rgb(233_235_236/0.2)] backdrop-blur">
      <span className="px-2 text-[var(--text-faint)]">404</span>
      {CORPUS.map((c) => (
        <Item key={c[0]} id={c[0]} name={c[1]} pick={pick} scope={scope} />
      ))}
      <span className="ml-2 px-2 text-[var(--text-faint)]">wake</span>
      {MISSING.map((m) => (
        <Item key={m[0]} id={m[0]} name={m[1]} pick={pick} scope={scope} />
      ))}
      <span className="ml-2 px-2 text-[var(--text-faint)]">error</span>
      {FAULT.map((f) => (
        <Item key={f[0]} id={f[0]} name={f[1]} pick={pick} scope={scope} />
      ))}
      <Link
        to="/design/fallback"
        search={{ v: pick, scope: scope === 'panel' ? undefined : 'panel' }}
        className="ml-2 rounded-full px-2.5 py-1 text-[var(--text-dim)] transition-colors hover:text-white"
      >
        {scope === 'panel' ? 'page' : 'panel'}
      </Link>
    </nav>
  );
}

function Item({
  id,
  name,
  pick,
  scope,
}: {
  id: string;
  name: string;
  pick: string;
  scope: string;
}) {
  return (
    <Link
      to="/design/fallback"
      search={{ v: id, scope: scope === 'panel' ? 'panel' : undefined }}
      className="rounded-full px-2.5 py-1 transition-colors"
      style={{ color: pick === id ? '#fff' : 'var(--text-dim)' }}
    >
      {name}
    </Link>
  );
}
