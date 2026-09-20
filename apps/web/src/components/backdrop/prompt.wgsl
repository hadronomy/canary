import { grain, ign, quantise } from "./ink.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// PROMPT — the page before anything has been asked of it.
//
// A scalar field, printed. Far from the composer the field is warped through
// itself and its bands wander; near the composer the warp relaxes and they
// straighten into parallel courses. That is the whole claim the product makes —
// drift in, structure out — so the backdrop states it rather than decorating
// around it.
//
// The structure is domain warping (Quilez): fbm evaluated at coordinates that
// fbm has already displaced. Plain fbm at this amplitude is a grey wash with no
// features to find; warping it folds the field into sheets and eddies that hold
// together across the screen, which is what gives the far side something worth
// being far from. The warp amplitude is what the composer relaxes, so order is
// the absence of warping rather than a second drawing fading in over the first.
//
// Tone is carried by dithering, not by a gradient. The field is quantised to
// six steps against an interleaved gradient noise threshold, so what reaches
// the screen is scattered pixels at a handful of levels. A backdrop this dark
// has perhaps twenty 8-bit codes to work with, and an undithered ramp across
// that spends them on visible bands; dithering trades the banding for grain,
// which is the trade every printing process has ever made.
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

// Steps across the whole 0..1 output range. The field only ever reaches about
// a third of that, so this leaves roughly six levels for it to land on: fewer
// and the dither becomes the subject, more and there is nothing left for it to
// do. Counted in output space rather than field space because that is where the
// quantising has to happen — see the tail of fs_main.
const STEPS = 18.0;

/// One octave stack, at a point and a moment.
fn layer(p: vec2f, t: f32) -> f32 {
  return fbmSimplex3d(vec3f(p, t), 3, 2.13, 0.5);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;
  let q = vec2f(uv.x * aspect, uv.y);

  // How far the ordering reaches. The keystroke kick is small on purpose: it
  // should register as the field noticing, not as the page lurching.
  let reach = (0.46 + params.amp * 0.16 + params.pulse * 0.04) * (1.0 - params.glitch * 0.5);

  // Two different falloffs, because they answer two different questions.
  //
  // `settled` is a horizontal band around the composer's line: the field
  // straightens across the full width, the way ruled paper does. Driving this
  // radially instead drew concentric rings centred on the composer, which reads
  // as a target rather than as anything settling.
  let settled = smoothstep(0.0, 1.0, clamp(1.0 - abs(uv.y - params.focus.y) / reach, 0.0, 1.0));

  // `near` is radial and only carries light, so the densest part of the setting
  // is where the eye already is.
  let near = smoothstep(
    0.0,
    1.0,
    clamp(1.0 - length((uv - params.focus) * vec2f(aspect, 1.0)) / (reach * 1.5), 0.0, 1.0),
  );

  // The warp, and the one thing the composer switches off. Squared so the
  // relaxing is slow at the edge of the region and decisive at its middle.
  let warp = (1.0 - settled * settled) * (1.0 + params.glitch * 1.6);

  // Each layer keeps its own clock. Run them together and the whole field
  // pulses on one beat, which reads as a loop; run them apart and the structure
  // reorganises continuously without ever travelling in a direction.
  //
  // The offsets are Quilez's. They carry no meaning beyond pulling unrelated
  // values out of one noise function.
  let base = q * 1.35;
  let w = vec2f(
    layer(base, params.time * 0.021),
    layer(base + vec2f(5.2, 1.3), params.time * 0.017),
  );

  let turbulence = layer(base + 4.0 * w * warp + vec2f(1.7, 9.2), params.time * 0.011) * 3.4;

  // The ordered term keeps a trace of the turbulence so the straightening reads
  // as the same field settling rather than as a second drawing fading in.
  let ordered = q.y * 7.0 + turbulence * 0.1;
  let psi = mix(turbulence, ordered, settled * settled);

  // A triangle wave across the field rather than a hairline through it: what
  // the dither needs is a smooth quantity, and a line thinner than a pixel has
  // nothing to say once it is quantised.
  let band = 1.0 - abs(fract(psi) - 0.5) * 2.0;

  // The exponent pushes most of the screen to the dark end. Without it every
  // pixel carries ink and the field reads as a fog rather than as a drawing.
  var tone = pow(band, 2.4) * (0.5 + near * 0.5);
  tone += near * near * 0.1;

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box. The vertical
  // falloff runs well past the region's own height for the same reason — the
  // composer is wide and short, and a proportional ease on a short axis is a
  // hard edge.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.42, min(uv.x - k.x, k.x + k.z - uv.x))
    * smoothstep(0.0, k.w * 1.6, min(uv.y - k.y, k.y + k.w - uv.y));
  tone *= 1.0 - room;

  // Everything continuous happens first, and the quantising happens last.
  //
  // Dithering the field and then multiplying by the falloff and the tint — both
  // smooth functions of position — reconstructs a smooth gradient out of the
  // steps and throws the dither away. It has to land on the values that are
  // actually written to the framebuffer, which is the same reason every source
  // on this says to dither immediately before the output quantises.
  let value = clamp(tone, 0.0, 1.0) * (0.14 + near * 0.17);
  var color = vec3f(value) * mix(vec3f(1.0), TINT, 0.45 + near * 0.35);
  color += vec3f(grain(px, params.time) * 0.005);

  // One threshold for all three channels. Per-channel thresholds dither the
  // hue as well as the level, which shows up as colour speckle on a tint this
  // saturated.
  let d = ign(px);
  return vec4f(
    quantise(color.r, STEPS, d),
    quantise(color.g, STEPS, d),
    quantise(color.b, STEPS, d),
    1.0,
  );
}
