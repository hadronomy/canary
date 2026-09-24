import type { ShaderSource } from '@vgpu/wgsl';
import type { RefObject } from 'react';

import { useEffect, useRef, useState } from 'react';

import { cn } from '~/lib/utils';

type Uniforms = Record<string, number | readonly number[]>;

type Prepass = {
  shader: ShaderSource;
  /** Binding name the next stage receives this target under. */
  as: string;
  /**
   * Fraction of the surface size to solve at. These fields are smooth and are
   * read through a linear sampler, so half resolution is four times cheaper for
   * no visible difference.
   */
  scale?: number;
};

type Props = {
  shader: ShaderSource;
  /**
   * Stages solved into offscreen targets before the live pass, in order. Each
   * one receives the previous stage's target under its `as` name, and the live
   * shader receives the last.
   *
   * This is for work that depends on layout rather than on time. Solving it once
   * per resize instead of once per frame is the difference between a backdrop
   * that runs anywhere and one that empties a battery.
   */
  prepass?: readonly Prepass[];
  /**
   * Extra bindings the live shader declares beyond `params` and the prepass
   * chain — a texture and its sampler, say. Resolved once after the context
   * exists and set before the first frame, because vgpu rejects a binding that
   * was never set.
   */
  bind?: (gpu: Awaited<ReturnType<typeof import('vgpu').init>>) => Promise<Record<string, unknown>>;
  /**
   * Cap for the live loop. Slow drift gains nothing from 120Hz, and every frame
   * skipped is a GPU wakeup that did not happen. An `fps` key on `state`
   * overrides it frame by frame, so whoever drives the field can run it fast
   * while something moves and let it idle when nothing does.
   */
  fps?: number;
  /**
   * Read once per frame and merged into `params`. A ref rather than a prop so
   * interaction can drive the shader at frame rate without re-rendering React.
   *
   * Setting `dirty` on it re-solves the prepass; the key is consumed here and
   * never reaches the shader.
   */
  state: RefObject<Uniforms>;
  className?: string;
};

/**
 * Renders a fullscreen vgpu effect behind the page.
 *
 * Decorative only: the page must be complete and legible with this absent, and
 * it is absent whenever WebGPU is unavailable or the device asks for reduced
 * motion. Nothing here is allowed to gate content.
 */
function Backdrop({ shader, state, prepass, bind, fps = 30, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !('gpu' in navigator)) return;

    let dead = false;
    let stop: (() => void) | undefined;

    void (async () => {
      // vgpu touches WebGPU at import time, so it cannot be in the SSR graph.
      const { clock, effect, frameLoop, init, sampler, surface, target } = await import('vgpu');
      const gpu = await init().catch(() => null);
      if (!gpu) return;
      if (dead) return gpu.dispose();

      // A shader that fails to compile draws nothing and throws nothing: the
      // error arrives asynchronously and the page just shows an empty panel.
      // In development every stage is compiled once more on its own so a
      // mistake is reported with its line, not discovered as a missing sky.
      if (import.meta.env.DEV) {
        for (const source of [shader, ...(prepass ?? []).map((spec) => spec.shader)]) {
          void gpu.gpu
            .createShaderModule({ code: source.wgsl })
            .getCompilationInfo()
            .then((info) => {
              const errors = info.messages.filter((message) => message.type === 'error');
              if (!errors.length) return;
              console.error(
                `Backdrop shader failed to compile:\n${errors
                  .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
                  .join('\n')}`,
              );
            });
        }
      }

      const surf = surface(gpu, node, { dpr: [1, 2] });
      const samp = sampler(gpu, {
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });

      function measure(scale: number) {
        return [
          Math.max(1, Math.round(surf.size[0] * scale)),
          Math.max(1, Math.round(surf.size[1] * scale)),
        ] as [number, number];
      }

      // `dirty` is a control key for the prepass and is not part of any shader's
      // uniform struct, so it never gets forwarded.
      function params(texel: readonly number[]) {
        const { dirty: _dirty, fps: _fps, ...rest } = state.current;
        return { texel, ...rest };
      }

      // Half-float, because velocity and the streamfunction are signed and run
      // well outside 0..1 — an 8-bit target would clamp the field flat.
      const chain = (prepass ?? []).map((spec) => ({
        spec,
        tgt: target(gpu, {
          size: measure(spec.scale ?? 1),
          format: 'rgba16float',
          label: spec.as,
        }),
        fx: effect(gpu, spec.shader, { label: spec.as }),
      }));

      function solve() {
        let prev: { as: string; tgt: (typeof chain)[number]['tgt'] } | null = null;
        for (const link of chain) {
          link.tgt.resize(measure(link.spec.scale ?? 1));
          link.fx.set({
            ...(prev ? { [prev.as]: prev.tgt, samp } : {}),
            params: { time: 0, ...params(link.tgt.texelSize) },
          });
          link.fx.draw(link.tgt);
          prev = { as: link.spec.as, tgt: link.tgt };
        }
        return prev;
      }

      const extra = bind ? await bind(gpu) : {};
      if (dead) return gpu.dispose();

      const tail = solve();
      const fx = effect(gpu, shader, {
        label: 'backdrop',
        set: {
          ...extra,
          ...(tail ? { [tail.as]: tail.tgt, samp } : {}),
          params: { time: 0, ...params(surf.texelSize) },
        },
      });

      let stale = false;
      surf.onResize(() => {
        fx.set({ params: { texel: surf.texelSize } });
        stale = true;
      });

      const time = clock(gpu);
      let drawn = 0;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

      // A reduced-motion visitor still gets the artwork, just not the drift: the
      // clock is frozen, and a frame is drawn only when the layout it depends on
      // has changed — a composer that moved, a page that became a thread —
      // checked a few times a second rather than every frame.
      if (still) {
        let seen = '';
        const loop = frameLoop(gpu, (frame) => {
          const now = performance.now();
          if (document.hidden || now - drawn < 250) return;
          drawn = now;

          const next = JSON.stringify(params(surf.texelSize));
          if (next === seen) return;
          seen = next;

          fx.set({ params: { ...params(surf.texelSize), time: 7.3 } });
          frame.pass(surf, fx);
        });

        setLive(true);
        stop = () => {
          loop.stop();
          gpu.dispose();
        };
        return;
      }

      const loop = frameLoop(gpu, (frame) => {
        // Skipped while the tab is hidden: a backdrop nobody can see is not
        // worth a GPU wakeup on someone's battery.
        if (document.hidden) return;

        const now = performance.now();
        const rate = Number(state.current.fps ?? fps);
        if (now - drawn < 1000 / rate) return;
        drawn = now;

        if (state.current.dirty) stale = true;
        if (stale) {
          state.current.dirty = 0;
          stale = false;
          const next = solve();
          if (next) fx.set({ [next.as]: next.tgt });
        }

        fx.set({ params: { time: time.time, ...params(surf.texelSize) } });
        frame.pass(surf, fx);
      });

      setLive(true);
      stop = () => {
        loop.stop();
        gpu.dispose();
      };
    })();

    return () => {
      dead = true;
      stop?.();
    };
  }, [shader, state, prepass, bind, fps]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 size-full transition-opacity duration-700 ease-out',
        live ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}

export { Backdrop };
export type { Uniforms };
