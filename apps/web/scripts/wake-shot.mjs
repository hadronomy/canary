// Render a wake-family backdrop headless, prepass chain and all, and write a PNG.
//
// The live wake shaders read a `weave` texture rather than solving the current
// themselves, so `shot.mjs` renders them pure black — it only ever binds
// `params`. This runs the real field -> weave -> live chain instead, which is
// the only way to judge one of these without a browser in the loop.
//
//   node scripts/wake-shot.mjs src/components/backdrop/wake.wgsl out.png '{"amp":0.5}'

import { resolveShader } from '@vgpu/wgsl/runtime';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { effect, init, sampler, target } from 'vgpu/node';

const [entry, out, extra] = process.argv.slice(2);

// The glyph and halftone screens are sized in *device* pixels, so a DPR-1 render
// draws them at twice the size they land at on the retina displays this is being
// judged on. Matching the browser's surface dpr cap is the difference between
// reading a letterform and reading a block.
const dpr = 2;
const css = [1280, 800];
const size = [css[0] * dpr, css[1] * dpr];
const half = [size[0] >> 1, size[1] >> 1];

const params = {
  texel: [1 / size[0], 1 / size[1]],
  // Roughly what the real text block measures at this size, so composition here
  // matches what lands in the browser.
  body: [0.42, 0.26],
  centre: [0.5, 0.5],
  time: 3.2,
  amp: 0.5,
  ...JSON.parse(extra ?? '{}'),
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

// Half resolution for both static stages, matching what the component does.
const a = target(gpu, { size: half, format: 'rgba16float', label: 'field' });
const b = target(gpu, { size: half, format: 'rgba16float', label: 'weave' });
const dest = target(gpu, { size });

const at = (t) => ({ ...params, texel: t.texelSize });

effect(gpu, field, { set: { params: at(a) } }).draw(a);
effect(gpu, weave, { set: { field: a, samp, params: at(b) } }).draw(b);
effect(gpu, live, { set: { weave: b, samp, params: at(dest) } }).draw(dest);

const pixels = await dest.read();
const png = new PNG({ width: size[0], height: size[1] });
png.data.set(pixels);
writeFileSync(out, PNG.sync.write(png));

// A frame that is one flat colour is the failure mode a PNG alone hides, and it
// is exactly how an unbound prepass presents.
let lo = 255;
let hi = 0;
let sum = 0;
let lit = 0;
for (let i = 0; i < pixels.length; i += 4) {
  const l = (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) | 0;
  if (l < lo) lo = l;
  if (l > hi) hi = l;
  if (l > 8) lit += 1;
  sum += l;
}
const count = pixels.length / 4;
console.log(
  JSON.stringify({
    out,
    luma: { lo, hi, mean: +(sum / count).toFixed(1) },
    coverage: +((lit / count) * 100).toFixed(1),
  }),
);
gpu.dispose();
