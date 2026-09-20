import { bayer, grain, quantise } from "./ink.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// PROMPT — the page before anything has been asked of it.
//
// A pool of light around the composer, textured by a slow field, printed
// through a coarse screen.
//
// Three layers, and the order of them is the whole design:
//
//   1. A static radial falloff from the composer. It never moves. This is the
//      composition — the thing that is the same shape every time you open the
//      page, and the reason the screen reads as a picture rather than as an
//      area of activity.
//   2. A domain-warped field (Quilez) that *modulates* that falloff rather than
//      replacing it. Texture, not subject. Because the static term dominates,
//      the field can drift without the picture appearing to change.
//   3. A Bayer screen on a coarse lattice, which is what makes tone visible as
//      dots opening and closing rather than as a gradient.
//
// The field is solved once per screen cell, at its centre, not per pixel. This
// is the difference between a picture printed through a screen and a screen
// laid on top of a picture: sampling per pixel leaves full-resolution detail
// under the dots, and that detail is what reads as noise. One value per cell
// means the dots *are* the image.
//
// Everything moves slowly and on one clock. Layers on separate clocks
// reorganise continuously, which is motion without composition — the page is
// never doing anything in particular but is never still either.
//
// Decorative only: the screen is complete and legible with this absent, and it
// is absent on every device without WebGPU or with reduced motion asked for.

struct Params {
  texel: vec2f,
  quiet: vec4f,  // x, y, w, h in viewport fractions — where the composer sits
  focus: vec2f,  // 0..1 viewport position the field organises toward
  time: f32,
  amp: f32,      // 0..1, widens the ordered region while the composer holds focus
  pulse: f32,    // 0..1, decaying kick per keystroke
  glitch: f32,   // 0..1, collapses the ordering when a send is rejected
}

@group(0) @binding(0) var<uniform> params: Params;

// Violet is the one hue the app spends. It is mixed into the ink rather than
// laid over it as a wash, so it arrives as the colour of the mark instead of as
// a filter sitting on top of one.
const TINT = vec3f(0.55, 0.40, 1.0);

// Steps across the whole 0..1 output range. Few enough that the screen has to
// open and close to carry a gradient, which is the whole point of it. Counted
// in output space rather than field space because that is where the quantising
// has to happen; see the tail of fs_main.
const STEPS = 9.0;

/// How many device pixels across one cell of the screen.
///
/// Derived from the surface width rather than fixed. A constant in device
/// pixels halves the pitch on a 2x display, which is how an earlier pass at
/// this ended up screening at one device pixel and disappearing into a flat
/// panel on exactly the machines it was being looked at on.
fn pitch(res: vec2f) -> f32 {
  return max(3.0, round(res.x / 400.0));
}

/// One octave stack, at a point and a moment.
fn layer(p: vec2f, t: f32) -> f32 {
  return fbmSimplex3d(vec3f(p, t), 3, 2.13, 0.5);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // Everything below is solved at the centre of the screen cell, not at this
  // pixel, so a whole cell shares one value and can carry one dot.
  let size = pitch(res);
  let cell = floor(px / size);
  let at = (cell + 0.5) * size * params.texel;
  let q = vec2f(at.x * aspect, at.y);

  // How far the light reaches. The keystroke kick is small on purpose: it
  // should register as the field noticing, not as the page lurching.
  let reach = (0.52 + params.amp * 0.14 + params.pulse * 0.03) * (1.0 - params.glitch * 0.4);

  // LAYER 1 — the composition, and the only term that carries real weight.
  // Static, radial, centred on the composer. Squared falloff so the pool has a
  // bright middle and a long dark edge rather than a linear ramp that reads as
  // a circle drawn on the page.
  let r = length((at - params.focus) * vec2f(aspect, 1.0)) / reach;
  let glow = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);

  // `settled` straightens the field along the composer's line, the way ruled
  // paper does. Radial instead drew concentric rings centred on the composer,
  // which reads as a target rather than as anything settling.
  let settled = smoothstep(0.0, 1.0, clamp(1.0 - abs(at.y - params.focus.y) / reach, 0.0, 1.0));

  // LAYER 2 — texture. The warp is the one thing the composer relaxes, so order
  // is the absence of warping rather than a second drawing fading in over the
  // first.
  let warp = (1.0 - settled * settled) * (1.0 + params.glitch * 1.6);

  // One clock, slow. The offsets are Quilez's and carry no meaning beyond
  // pulling unrelated values out of one noise function.
  let t = params.time * 0.012;
  let base = q * 0.8;
  let w = vec2f(layer(base, t), layer(base + vec2f(5.2, 1.3), t));
  let turbulence = layer(base + 2.2 * w * warp + vec2f(1.7, 9.2), t) * 1.4;

  // The ordered term keeps a trace of the turbulence so the straightening reads
  // as the same field settling rather than as a second drawing fading in.
  let psi = mix(turbulence, q.y * 5.0 + turbulence * 0.1, settled * settled);

  // A triangle wave across the field: what a screen needs is a smooth quantity
  // to open and close against.
  let band = 1.0 - abs(fract(psi) - 0.5) * 2.0;

  // The field never sets the level, only varies it. Held between 0.55 and 1.0
  // the picture stays the pool of light it was, and the drift reads as the
  // texture of that light rather than as something happening.
  var tone = glow * (0.55 + 0.45 * pow(band, 1.4));

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box. The vertical
  // falloff runs well past the region's own height for the same reason — the
  // composer is wide and short, and a proportional ease on a short axis is a
  // hard edge.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.42, min(at.x - k.x, k.x + k.z - at.x))
    * smoothstep(0.0, k.w * 1.6, min(at.y - k.y, k.y + k.w - at.y));
  tone *= 1.0 - room;

  // Everything continuous happens first, and the quantising happens last.
  //
  // Screening the field and then multiplying by the falloff and the tint — both
  // smooth functions of position — reconstructs a continuous gradient out of
  // the steps and throws the screen away. It has to land on the values actually
  // written to the framebuffer.
  let value = clamp(tone, 0.0, 1.0) * 0.46;
  var color = vec3f(value) * mix(vec3f(1.0), TINT, 0.5 + glow * 0.3);

  // Grain on the pixel rather than the cell, and barely there. It is the only
  // thing in the image finer than a cell, which is what keeps the dots from
  // reading as a rendering resolution.
  color += vec3f(grain(px, params.time) * 0.004);

  // One threshold for all three channels. Per-channel thresholds screen the hue
  // as well as the level, which shows up as colour speckle on a tint this
  // saturated.
  //
  // Ordered rather than blue-noise-like: a scattered threshold hides itself by
  // design, and the job here is a pattern you can see. The matrix is read on
  // the cell, so one cell of the screen carries one threshold.
  let d = bayer(vec2u(vec2i(cell) & vec2i(7)), 3u);
  return vec4f(
    quantise(color.r, STEPS, d),
    quantise(color.g, STEPS, d),
    quantise(color.b, STEPS, d),
    1.0,
  );
}
