import { bayer, quantise, grain } from "./ink.wgsl";

// WAKE · HALFTONE — the corpus as a printed screen, pulled around the absence.
//
// Same current as `wake`, set as a halftone instead of as letterforms. Tone is
// carried by dot area rather than by ink density, which is what separates a
// printing screen from a grey wash: every dot is solid black, and the page gets
// lighter only because the dots get smaller.
//
// The screen is laid on the flow's own axes rather than on the screen's. A real
// press rotates its screen off-axis to keep the lattice from beating against the
// paper grid; here the rotation is the velocity field, so the dot rows shear
// along the streamlines and the ruling opens where the current slows. That is
// the whole idea — you read the flow off the screen angle, not off brightness.

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

const PITCH = 7.0;  // screen ruling, device pixels between dot centres
const DRIFT = 22.0; // device pixels a second, downstream

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;

  let f = textureSampleLevel(weave, samp, uv, 0.0);
  let dir = f.xy;
  let density = f.z;
  let psi = f.w;

  if (density <= 0.001) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  // One slow breath so a field solved once is not a frozen one.
  let breath = density * (0.88 + 0.12 * sin(params.time * 0.25 + psi * 1.4));

  // A halftone inks every cell it covers, where the letterform screen only inks
  // the cells it happens to select — so the same density field lands about three
  // times heavier here. The gamma pulls the midtones back down and hands the
  // page to the type, which is the only thing on it that has to be read.
  let tone = clamp(pow(max(breath, 0.0), 1.7), 0.0, 1.0);

  // Screen axes from the flow: `t` runs downstream, `n` across it. Both come out
  // of `weave` already normalised.
  let t = dir;
  let n = vec2f(-t.y, t.x);
  let cell = vec2f(dot(px, t) - params.time * DRIFT, dot(px, n)) / PITCH;

  // Dot area carries the tone, so the radius goes as its square root. Skipping
  // the root is the usual halftone mistake: it makes the midtones far too dark
  // because area grows quadratically with what you asked for.
  let seat = fract(cell) - 0.5;
  let reach = sqrt(tone) * 0.72;

  // The dither runs on the coverage rather than on the output, so the screen
  // keeps hard black dots on white and only their *size* is quantised. One
  // threshold per dot, not per pixel, or the dot edges dissolve into noise.
  let step = bayer(vec2u(floor(cell) + 512.0), 3u);
  let radius = quantise(reach, 7.0, step);

  // Anti-aliased against the dot's own edge. `fwidth` here would key off the
  // sheared coordinate and swell wherever the flow turns, so the pitch sets the
  // softness instead: one device pixel, expressed in cell units.
  let soft = 1.0 / PITCH;
  let ink = 1.0 - smoothstep(radius - soft, radius + soft, length(seat));

  // Two ink weights, as `wake` has. A press lays down one black; the lighter
  // value here is the same black printed at a coarser screen further from the
  // jet, not a grey.
  let heavy = smoothstep(0.35, 0.85, tone);
  var value = ink * mix(0.20, 0.46, heavy);

  // The inversion has a hard boundary — inside the block it has no answer at
  // all — so without this the screen stops against the body like a cut sticker.
  // Fading the last stretch of coverage turns that edge back into water closing
  // on something rather than a shape pasted over the page.
  value *= smoothstep(0.0, 0.16, density);

  value += grain(px, params.time) * 0.012;
  return vec4f(vec3f(max(value, 0.0)), 1.0);
}
