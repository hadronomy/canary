// Render a backdrop .wgsl headless and write a PNG, so composition and tone can
// be judged (and diffed) without a browser in the loop.
//
//   node scripts/shot.mjs src/components/backdrop/signal.wgsl out.png '{"amp":0.6}'

import { resolveShader } from '@vgpu/wgsl/runtime';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { effect, init, target } from 'vgpu/node';

const [entry, out, extra] = process.argv.slice(2);
const size = [1280, 800];

const shader = await resolveShader({ entry: resolve(entry) });
const gpu = await init();
const dest = target(gpu, { size });

const params = {
  texel: [1 / size[0], 1 / size[1]],
  time: 3.2,
  amp: 0,
  pulse: 0,
  glitch: 0,
  ...JSON.parse(extra ?? '{}'),
};

effect(gpu, shader.wgsl, { set: { params } }).draw(dest);

const pixels = await dest.read();
const png = new PNG({ width: size[0], height: size[1] });
png.data.set(pixels);
writeFileSync(out, PNG.sync.write(png));

// A frame that is one flat colour is the failure mode a PNG alone hides.
let lo = 255;
let hi = 0;
let sum = 0;
for (let i = 0; i < pixels.length; i += 4) {
  const l = (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) | 0;
  if (l < lo) lo = l;
  if (l > hi) hi = l;
  sum += l;
}
console.log(
  JSON.stringify({ out, luma: { lo, hi, mean: +(sum / (pixels.length / 4)).toFixed(1) } }),
);
gpu.dispose();
