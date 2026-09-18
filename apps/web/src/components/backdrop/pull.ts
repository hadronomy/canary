import type { RefObject } from 'react';

import { useEffect } from 'react';

import type { Uniforms } from '~/components/backdrop/backdrop';

/**
 * Lean a backdrop's mass toward the pointer.
 *
 * Writes straight into the uniform ref rather than through state: the shader
 * reads that ref once a frame anyway, so the whole interaction runs without
 * React re-rendering anything. A `useState` here would re-render the page on
 * every pointermove to move something the DOM cannot see.
 *
 * Decorative, and gated like it. Touch pointers have no hover to track, and a
 * visitor who asked for reduced motion did not ask for a page that follows them
 * around — both get the composed, still artwork instead.
 */
function usePull(state: RefObject<Uniforms>, host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Section units. Small on purpose: this should register as the page having
    // noticed you, not as something chasing the cursor.
    const reach = 0.06;

    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let vx = 0;
    let vy = 0;
    let raf = 0;

    // A spring, not a direct mapping. Tying the offset straight to the pointer
    // reads as mechanical because it has no weight; the overshoot and settle are
    // the entire reason this feels like mass rather than like a cursor.
    function tick() {
      const k = 0.075;
      const damp = 0.82;

      vx = (vx + (tx - cx) * k) * damp;
      vy = (vy + (ty - cy) * k) * damp;
      cx += vx;
      cy += vy;

      const rest = Math.abs(tx - cx) + Math.abs(ty - cy) + Math.abs(vx) + Math.abs(vy);
      if (rest < 1e-4) {
        cx = tx;
        cy = ty;
        raf = 0;
      } else {
        raf = requestAnimationFrame(tick);
      }

      state.current.pull = [cx, cy];
    }

    function wake() {
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function move(e: PointerEvent) {
      const b = node!.getBoundingClientRect();
      if (!b.width || !b.height) return;
      tx = ((e.clientX - b.left) / b.width - 0.5) * 2 * reach;
      ty = ((e.clientY - b.top) / b.height - 0.5) * 2 * reach;
      wake();
    }

    function leave() {
      tx = 0;
      ty = 0;
      wake();
    }

    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);

    return () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [state, host]);
}

export { usePull };
