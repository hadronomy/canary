import { useCallback, useEffect, useRef } from 'react';

import type { Uniforms } from '~/components/backdrop/backdrop';

type State = {
  amp: number;
  pulse: number;
  glitch: number;
  /** 0..1 progress of a sent message travelling out through the field; 0 at
   *  rest. Linear here — the shader shapes it. */
  launch: number;
  /** Where the current launch left from, fixed at the moment of sending, so
   *  the wave keeps its centre while the composer that sent it moves on. */
  spot: [number, number];
  /** Mutated in place each frame — the shader reads this array, so replacing it
   *  would strand the reference the uniform write is holding. */
  focus: [number, number];
};

/** Seconds a launch takes to cross the field. */
const LAUNCH = 0.9;

/**
 * Bridges form interaction to the backdrop shader.
 *
 * Values live in a ref and are eased on an animation frame rather than held in
 * React state: the shader samples them once per frame, and routing a keystroke
 * through a re-render just to move a float would drop frames on every letter
 * typed. Returns handlers to spread onto the form.
 *
 * `seed` carries any extra uniform a particular backdrop declares. It has to be
 * present from the first frame — vgpu rejects a struct member that was never
 * set, so seeding it later is too late.
 */
function useField(seed?: Uniforms) {
  const state = useRef<State & Uniforms>({
    amp: 0,
    pulse: 0,
    glitch: 0,
    launch: 0,
    spot: [0.5, 0.5],
    focus: [0.5, 0.5],
    ...seed,
  });
  const going = useRef(false);
  const want = useRef({ amp: 0, glitch: 0, x: 0.5, y: 0.5 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    function tick(now: number) {
      // Clamped so a backgrounded tab does not resume with one huge step that
      // snaps every eased value to its target at once.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = state.current;

      // Frame-rate independent exponential approach. Focus is deliberately
      // slower to arrive than to leave, so the field feels like it settles.
      const rate = want.current.amp > s.amp ? 6 : 9;
      s.amp += (want.current.amp - s.amp) * (1 - Math.exp(-rate * dt));
      s.glitch += (want.current.glitch - s.glitch) * (1 - Math.exp(-7 * dt));

      // Attention travels rather than teleports: a lens that jumps between
      // fields reads as a cut, and there is nothing to follow.
      const at = s.focus;
      at[0] += (want.current.x - at[0]) * (1 - Math.exp(-5.5 * dt));
      at[1] += (want.current.y - at[1]) * (1 - Math.exp(-5.5 * dt));
      // Slower than the rise, so the swell reads as a breath rather than a blink.
      s.pulse *= Math.exp(-2.4 * dt);

      // Played rather than eased toward a target: a launch has a start and an
      // end, and it runs through once whatever else the field is doing.
      if (going.current) {
        s.launch = Math.min(s.launch + dt / LAUNCH, 1);
        going.current = s.launch < 1;
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const focus = useCallback((on: boolean) => {
    want.current.amp = on ? 1 : 0;
  }, []);

  const beat = useCallback((at?: { x: number; y: number }) => {
    // Small and additive: one keystroke should nudge the field, not flash it.
    // Held keys still accumulate, capped so a leaned-on key cannot peg it.
    state.current.pulse = Math.min(state.current.pulse + 0.2, 0.85);
    if (at) state.current.focus = [at.x, at.y];
  }, []);

  /** Point the backdrop at a place on screen, in 0..1 viewport coordinates. */
  const aim = useCallback((x: number, y: number) => {
    want.current.x = x;
    want.current.y = y;
  }, []);

  /** Aim at an element's centre. */
  const aimAt = useCallback(
    (node: Element | null) => {
      if (!node) return;
      const box = node.getBoundingClientRect();
      aim((box.left + box.width / 2) / innerWidth, (box.top + box.height / 2) / innerHeight);
    },
    [aim],
  );

  /** Write a uniform the backdrop reads but nothing here eases. */
  const put = useCallback((name: string, value: number | readonly number[]) => {
    state.current[name] = value;
  }, []);

  const fault = useCallback((on: boolean) => {
    want.current.glitch = on ? 1 : 0;
  }, []);

  /** Send a wave out from the focus point, or put the field back at rest. */
  const launch = useCallback((on: boolean) => {
    state.current.launch = 0;
    state.current.spot = [state.current.focus[0], state.current.focus[1]];
    going.current = on;
  }, []);

  return { state: state as { current: Uniforms }, focus, beat, fault, put, aim, aimAt, launch };
}

export { useField };
