import { hairline, sweep } from "./contour.wgsl";
import { bayer, quantise, grain } from "./ink.wgsl";

// WAKE · SILK — the current drawn as its own contour lines.
//
// Same field as `wake`, read the way a chart reads it. Every line here is one
// contour of the streamfunction, so the lines *are* the streamlines: they crowd
// where the current accelerates into the gap beside the block and open out again
// downstream, because that is what a streamfunction does. No texture, no
// letterforms, nothing scattered on top — the drawing is the measurement.
//
// The lines do not move. A steady flow has steady streamlines, and sliding the
// contour phase in time does not carry ink along a line — it migrates each line
// sideways onto a neighbouring streamline. Worse, screen-space line speed goes
// as phase speed over gradient, so the widely spaced lines in slow water travel
// fastest: up to about eleven pixels a frame for a line two and a half pixels
// wide. That is not drift, it is a strobe, and it is what made this blink.
//
// So the drawing is fixed and the *light* moves through it.

struct Params {
  texel: vec2f,
  body: vec2f,   // half-width and half-height of the block, flow units
  centre: vec2f, // 0..1 position of the block within the section
  time: f32,
  amp: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var weave: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const LINES = 92.0;  // contours across the streamfunction's range
const DEEP = 11.0;   // the coarse set held behind them
const WAVE = 620.0;  // device pixels between wave crests, downstream
const SPEED = 54.0;  // device pixels a second the wave travels

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;

  let f = textureSampleLevel(weave, samp, uv, 0.0);
  let density = f.z;
  let psi = f.w;

  // Every derivative is taken here, above any branch. `fwidth` reads the two
  // neighbouring pixels of its quad, so it is only defined where all four agree
  // on having reached it — putting the void's early return first would make the
  // whole rest of this function non-uniform and the shader would not compile.
  let phase = psi * LINES;
  let grad = fwidth(phase);
  let deepPhase = psi * DEEP;
  let deepGrad = fwidth(deepPhase);

  if (density <= 0.001) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  // A long, shallow wave running downstream along the lines, plus one slower
  // breath underneath it. Both are broad and smooth, so what the eye reads is
  // the field brightening and dimming in bands rather than anything moving.
  let wave = 0.66 + 0.34 * sweep(px, psi, params.time, WAVE, SPEED, 2.1);
  let breath = 0.92 + 0.08 * sin(params.time * 0.22 + psi * 1.4);
  let alive = density * wave * breath;

  let line = hairline(phase, grad) * alive;
  let deep = hairline(deepPhase, deepGrad) * alive * 0.26;

  var value = line * 0.72 + deep;

  // Fine steps against a static threshold. The banding this kills is in the
  // wave, which is a smooth ramp across the whole page; the lines are already
  // hard-edged and the ordered pattern under them never moves, so nothing here
  // crawls between frames.
  value = quantise(clamp(value, 0.0, 1.0), 24.0, bayer(vec2u(px), 3u));

  value += grain(px, params.time) * 0.008;
  return vec4f(vec3f(max(value, 0.0)), 1.0);
}
