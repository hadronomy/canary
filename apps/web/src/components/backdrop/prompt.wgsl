import { bayer, grain } from "./ink.wgsl";
import { hairline, sweep } from "./contour.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// PROMPT — the page before anything has been asked of it.
//
// A scalar field drawn as its own contour lines. Far from the composer the
// field is turbulent and its lines wander; near the composer they straighten
// into parallel courses. That is the whole claim the product makes — drift in,
// structure out — so the backdrop states it rather than decorating around it.
//
// The lines themselves never move. Steady flow has steady streamlines, and a
// hairline that travels crosses several pixels a frame and strobes. What moves
// is brightness along them, which reads as current without any of the aliasing.
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

// Violet is the one hue the app spends. It is mixed into the lines rather than
// laid over them as a wash, so it arrives as the colour of the drawing instead
// of as a filter sitting on top of it.
const TINT = vec3f(0.55, 0.40, 1.0);

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

  // `near` is radial and only carries light, so the brightest part of the
  // drawing is where the eye already is.
  let near = smoothstep(
    0.0,
    1.0,
    clamp(1.0 - length((uv - params.focus) * vec2f(aspect, 1.0)) / (reach * 1.5), 0.0, 1.0),
  );

  // Both terms are scaled to put a comparable number of contours on screen, or
  // the lines would crowd on one side of the blend and thin out on the other.
  // The ordered term keeps a trace of the turbulence so the straightening reads
  // as the same field settling rather than as a second drawing fading in.
  let turbulence = fbmSimplex3d(vec3f(q * 2.4, params.time * 0.05), 4, 2.13, 0.5) * 3.4;
  let ordered = q.y * 7.0 + turbulence * 0.1;
  let psi = mix(turbulence, ordered, settled * settled);

  // fwidth in uniform control flow, then handed to the hairline: that division
  // is what holds the line to one width where the field steepens.
  let line = hairline(psi, fwidth(psi));
  let wave = sweep(px, psi, params.time, 280.0, 24.0, 0.4);

  // Ordered lines carry more light than wandering ones, so the resolved region
  // reads as the brighter one without anything being drawn on top of it.
  var value = line * (0.12 + wave * 0.18) * (0.45 + near * 0.55);

  // Enough of a lift that the centre is not dead black.
  value += near * near * 0.02;

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box. The vertical
  // falloff runs well past the region's own height for the same reason — the
  // composer is wide and short, and a proportional ease on a short axis is a
  // hard edge.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.42, min(uv.x - k.x, k.x + k.z - uv.x))
    * smoothstep(0.0, k.w * 1.6, min(uv.y - k.y, k.y + k.w - uv.y));
  value *= 1.0 - room;

  var color = vec3f(value) * mix(vec3f(1.0), TINT, 0.45 + near * 0.35);

  // Ordered dither at one 8-bit step, then grain. Quantising the ramp itself
  // showed the Bayer matrix as a dot screen; nudging the final value by less
  // than a level scatters the boundary instead of drawing it.
  color += vec3f((bayer(vec2u(px), 3u) - 0.5) / 255.0);
  color += vec3f(grain(px, params.time) * 0.008);
  return vec4f(color, 1.0);
}
