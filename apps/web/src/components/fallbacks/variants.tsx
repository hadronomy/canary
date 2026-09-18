import { useRef } from 'react';

import type { Scope } from '~/components/fallbacks/shell';

import { Backdrop } from '~/components/backdrop/backdrop';
import uncited from '~/components/backdrop/uncited.wgsl';
import voidField from '~/components/backdrop/void.wgsl';
import halftone from '~/components/backdrop/wake-halftone.wgsl';
import lens from '~/components/backdrop/wake-lens.wgsl';
import silk from '~/components/backdrop/wake-silk.wgsl';
import strata from '~/components/backdrop/wake-strata.wgsl';
import { Action, Actions, Kicker, Note, Ref, Shell, Title } from '~/components/fallbacks/shell';
import { Wake } from '~/components/fallbacks/wake';

type MissingProps = { scope?: Scope; path: string };

function back() {
  globalThis.history.back();
}

/* ── 404 · Void ───────────────────────────────────────────────────────────
   The sign-in page resolves toward its centre. This runs that backwards: the
   result set fills the field and stops short, leaving a hole where the answer
   would have been. */

function MissingVoid({ scope, path }: MissingProps) {
  const state = useRef({ amp: 0.3 });

  return (
    <Shell scope={scope} artifact={<Backdrop shader={voidField} state={state} />}>
      <div className="text-center">
        <Kicker>404 · empty set</Kicker>
        <Title>No matching fragment.</Title>
        <p className="mx-auto mt-3 max-w-[36ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
          The retrieval ran and came back with nothing. The reference below has no version in the
          corpus.
        </p>
        <p className="code mx-auto mt-6 max-w-full break-all text-[11px] text-[var(--text-dim)]">
          {path}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Action href="/" primary>
            Go home
          </Action>
          <Action onClick={back}>Go back</Action>
        </div>
      </div>
    </Shell>
  );
}

/* ── 404 · Uncited ────────────────────────────────────────────────────────
   The corpus is a graph before it is a list, so a broken reference is not an
   empty page — it is live edges pointing at a node that is not there. The
   absence is one vacant slot in a working graph rather than a hole punched
   through the middle of it. */

function MissingUncited({ scope, path }: MissingProps) {
  // Off to the upper right of the copy, where the dangling edges are readable
  // against empty page rather than through a paragraph.
  const state = useRef({ amp: 0.4, focus: [0.7, 0.33] });

  return (
    <Shell scope={scope} artifact={<Backdrop shader={uncited} state={state} />}>
      <Kicker>404 · uncited</Kicker>
      <Title>This citation leads nowhere.</Title>
      <Note>
        The reference resolves to no document in the corpus. Check the identifier, or start again
        from a norm you know exists.
      </Note>
      <Ref label="ref">{path}</Ref>

      <Actions>
        <Action href="/" primary>
          Go home
        </Action>
        <Action onClick={back}>Go back</Action>
      </Actions>
    </Shell>
  );
}

const MissingWakeLens = (p: MissingProps) => <Wake {...p} shader={lens} />;
const MissingWakeHalftone = (p: MissingProps) => <Wake {...p} shader={halftone} />;
const MissingWakeSilk = (p: MissingProps) => <Wake {...p} shader={silk} />;
const MissingWakeStrata = (p: MissingProps) => <Wake {...p} shader={strata} />;

export {
  MissingUncited,
  MissingVoid,
  MissingWakeHalftone,
  MissingWakeLens,
  MissingWakeSilk,
  MissingWakeStrata,
};
