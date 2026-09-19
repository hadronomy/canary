import { ascii, asciiCell, asciiCellSize, asciiCentre } from "./ascii.wgsl";
import { bayer, grain } from "./ink.wgsl";
import { sweep } from "./contour.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// PROMPT — the page before anything has been asked of it.
//
// A scalar field, set as type. Far from the composer the field is turbulent and
// its bands wander; near the composer they straighten into parallel courses.
// That is the whole claim the product makes — drift in, structure out — so the
// backdrop states it rather than decorating around it.
//
// The drawing goes through an ASCII ramp: one character per cell, chosen by how
// much ink the value there needs. It replaced contour hairlines, which were a
// sub-pixel line fighting the dither for the same pixel and losing. Characters
// also say something a hairline cannot — this is a machine reading text.
//
// The field is sampled once per cell rather than per pixel. Sampling per pixel
// draws a gradient and then punches character-shaped holes in it, which reads
// as a texture laid over a picture instead of as type.
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

// Violet is the one hue the app spends. It is mixed into the characters rather
// than laid over them as a wash, so it arrives as the colour of the type
// instead of as a filter sitting on top of it.
const TINT = vec3f(0.55, 0.40, 1.0);

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // Everything below is solved at the centre of the character cell, not at this
  // pixel, so a whole cell shares one value and can carry one letter.
  let size = asciiCellSize(res);
  let cell = asciiCell(px, size);
  let centre = asciiCentre(cell, size);
  let at = centre * params.texel;
  let q = vec2f(at.x * aspect, at.y);

  // How far the ordering reaches. The keystroke kick is small on purpose: it
  // should register as the field noticing, not as the page lurching.
  let reach = (0.46 + params.amp * 0.16 + params.pulse * 0.04) * (1.0 - params.glitch * 0.5);

  // Two different falloffs, because they answer two different questions.
  //
  // `settled` is a horizontal band around the composer's line: the field
  // straightens across the full width, the way ruled paper does. Driving this
  // radially instead drew concentric rings centred on the composer, which reads
  // as a target rather than as anything settling.
  let settled = smoothstep(0.0, 1.0, clamp(1.0 - abs(at.y - params.focus.y) / reach, 0.0, 1.0));

  // `near` is radial and only carries light, so the densest part of the setting
  // is where the eye already is.
  let near = smoothstep(
    0.0,
    1.0,
    clamp(1.0 - length((at - params.focus) * vec2f(aspect, 1.0)) / (reach * 1.5), 0.0, 1.0),
  );

  // Both terms are scaled to put a comparable number of bands on screen, or the
  // field would crowd on one side of the blend and thin out on the other. The
  // ordered term keeps a trace of the turbulence so the straightening reads as
  // the same field settling rather than as a second drawing fading in.
  let turbulence = fbmSimplex3d(vec3f(q * 2.4, params.time * 0.05), 4, 2.13, 0.5) * 3.4;
  let ordered = q.y * 7.0 + turbulence * 0.1;
  let psi = mix(turbulence, ordered, settled * settled);

  // A triangle wave across the field rather than a hairline through it: the
  // ramp needs a smooth quantity to pick a character from, and a line thinner
  // than a cell has nothing to say at this resolution.
  let band = 1.0 - abs(fract(psi) - 0.5) * 2.0;
  let wave = sweep(centre, psi, params.time, 280.0, 24.0, 0.4);

  // The exponent pushes most cells to the blank end of the ramp. Without it
  // every cell carries a character and the field reads as a wall of text.
  var ink = pow(band, 1.7) * (0.4 + wave * 0.6) * (0.5 + near * 0.5);
  ink += near * near * 0.1;

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box. The vertical
  // falloff runs well past the region's own height for the same reason — the
  // composer is wide and short, and a proportional ease on a short axis is a
  // hard edge.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.42, min(at.x - k.x, k.x + k.z - at.x))
    * smoothstep(0.0, k.w * 1.6, min(at.y - k.y, k.y + k.w - at.y));
  ink *= 1.0 - room;

  // Ordered dither on the cell, not the pixel: neighbouring cells land on
  // different characters across a ramp boundary, which is what keeps a shallow
  // gradient from terracing into visible steps of one character each.
  let lit = ascii(px, size, clamp(ink, 0.0, 1.0), bayer(vec2u(vec2i(cell) & vec2i(7)), 3u) - 0.5);

  let value = lit * (0.13 + near * 0.19);
  var color = vec3f(value) * mix(vec3f(1.0), TINT, 0.45 + near * 0.35);
  color += vec3f(grain(px, params.time) * 0.008);
  return vec4f(color, 1.0);
}
