// Measure how much a backdrop changes between consecutive frames.
//
// "It blinks" is a temporal complaint, and a still frame cannot show it. This
// renders the wake chain at the interval the component actually runs at and
// reports the mean absolute difference between one frame and the next, plus the
// share of pixels that swing hard enough to read as a pop rather than as drift.
//
// Interpreting it: slow drift lands near 1. Anything above ~4 mean, or a pop
// share above ~2%, is visible flicker on a dark field.
//
//   node scripts/flicker.mjs src/components/backdrop/wake-silk.wgsl

import { resolveShader } from '@vgpu/wgsl/runtime';
import { resolve } from 'node:path';
import { effect, init, sampler, target } from 'vgpu/node';

const [entry, fpsArg] = process.argv.slice(2);
const fps = Number(fpsArg ?? 30);
const dpr = 2;
const size = [1280 * dpr, 800 * dpr];
const half = [size[0] >> 1, size[1] >> 1];

const base = {
  texel: [1 / size[0], 1 / size[1]],
  body: [0.42, 0.26],
  centre: [0.5, 0.5],
  amp: 0.5,
};

const dir = resolve('src/components/backdrop');
const load = (name) => resolveShader({ entry: `${dir}/${name}` }).then((s) => s.wgsl);

const [field, weave, live] = await Promise.all([
  load('field.wgsl'),
  load('weave.wgsl'),
  resolveShader({ entry: resolve(entry) }).then((s) => s.wgsl),
]);

const gpu = await init();
const samp = sampler(gpu, {
  minFilter: 'linear',
  magFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
});

const a = target(gpu, { size: half, format: 'rgba16float', label: 'field' });
const b = target(gpu, { size: half, format: 'rgba16float', label: 'weave' });
const dest = target(gpu, { size });

// The current is static, so it is solved once here exactly as the component
// solves it once on resize.
effect(gpu, field, { set: { params: { ...base, texel: a.texelSize, time: 0 } } }).draw(a);
effect(gpu, weave, {
  set: { field: a, samp, params: { ...base, texel: b.texelSize, time: 0 } },
}).draw(b);

const fx = effect(gpu, live, {
  set: { weave: b, samp, params: { ...base, texel: dest.texelSize, time: 0 } },
});

async function shot(time) {
  fx.set({ params: { ...base, texel: dest.texelSize, time } });
  fx.draw(dest);
  return dest.read();
}

const gap = 1 / fps;
let prev = await shot(3.2);
const runs = [];

for (let i = 1; i <= 8; i += 1) {
  const next = await shot(3.2 + i * gap);
  let sum = 0;
  let pops = 0;
  for (let p = 0; p < next.length; p += 4) {
    const d = Math.abs(next[p] - prev[p]);
    sum += d;
    // 12/255 is roughly where a single-frame step stops reading as motion and
    // starts reading as a pixel switching on.
    if (d > 12) pops += 1;
  }
  const count = next.length / 4;
  runs.push({ mean: sum / count, pop: (pops / count) * 100 });
  prev = next;
}

const mean = runs.reduce((t, r) => t + r.mean, 0) / runs.length;
const pop = runs.reduce((t, r) => t + r.pop, 0) / runs.length;
console.log(
  JSON.stringify({
    entry: entry.split('/').pop(),
    fps,
    frameDelta: +mean.toFixed(2),
    popShare: +pop.toFixed(2),
  }),
);
gpu.dispose();
