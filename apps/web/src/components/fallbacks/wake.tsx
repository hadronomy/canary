import type { ShaderSource } from '@vgpu/wgsl';

import { useLayoutEffect, useRef } from 'react';

import type { Uniforms } from '~/components/backdrop/backdrop';
import type { Scope } from '~/components/fallbacks/shell';

import { Backdrop } from '~/components/backdrop/backdrop';
import field from '~/components/backdrop/field.wgsl';
import { usePull } from '~/components/backdrop/pull';
import wake from '~/components/backdrop/wake.wgsl';
import weave from '~/components/backdrop/weave.wgsl';
import { Action, Actions, Kicker, Note, Ref, Shell, Title } from '~/components/fallbacks/shell';

type Props = {
  scope?: Scope;
  path: string;
  /** The live pass. Every wake reading shares the same solved current. */
  shader?: ShaderSource;
};

// The current, convolution and all, depends only on where the block sits, so it
// is solved into textures on resize rather than per frame. Half resolution: both
// fields are smooth and are read back through a linear sampler.
//
// Module scope because Backdrop holds this in an effect dependency — rebuilding
// the array each render would tear the device down and back up every time.
const CURRENT = [
  { shader: field, as: 'field', scale: 0.5 },
  { shader: weave, as: 'weave', scale: 0.5 },
] as const;

/**
 * The not-found page.
 *
 * Everything around the reference is indexed and moving. The reference itself is
 * not there, so the corpus runs past it and closes up behind.
 */
function Wake({ scope, path, shader = wake }: Props) {
  const state = useRef<Uniforms>({ amp: 0.5, body: [0.5, 0.3], centre: [0.5, 0.5], pull: [0, 0] });
  const block = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLElement | null>(null);

  // The body the current parts around is the text block itself, measured and
  // handed to the shader. Sized against the section rather than the window so
  // this still lands when the fallback is a panel inside the app.
  useLayoutEffect(() => {
    const node = block.current;
    const root = node?.closest('section');
    if (!node || !root) return;

    function fit() {
      if (!node || !root) return;
      const b = node.getBoundingClientRect();
      const h = root.getBoundingClientRect();
      if (!h.height) return;

      // SPAN flow units span one section height. A squircle tracks a rectangle
      // far more closely than an ellipse does, so it needs little padding to
      // clear the block — this is air around the type, not slack in the fit.
      const k = 2.4 / h.height;
      const air = 1.26;

      state.current.body = [(b.width / 2) * k * air, (b.height / 2) * k * air];
      state.current.centre = [
        (b.left - h.left + b.width / 2) / h.width,
        (b.top - h.top + b.height / 2) / h.height,
      ];

      // The current is baked into a texture. Without this the flow keeps parting
      // around where the block used to be.
      state.current.dirty = 1;
    }

    host.current = root;

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  usePull(state, host);

  return (
    <Shell scope={scope} artifact={<Backdrop shader={shader} state={state} prepass={CURRENT} />}>
      <div ref={block}>
        {/* A writ to produce the body, answered with nothing. Lawyers get the
            joke; everyone else still has a plain headline under it. */}
        <Kicker>404 · habeas corpus</Kicker>
        <Title>Nothing on record.</Title>
        <Note>
          The corpus has no document at this address. Either the link is old, or the reference has a
          typo.
        </Note>
        <Ref label="ref">{path}</Ref>

        <Actions>
          <Action href="/" primary>
            Go home
          </Action>
          <Action onClick={() => globalThis.history.back()}>Go back</Action>
        </Actions>
      </div>
    </Shell>
  );
}

export { Wake };
