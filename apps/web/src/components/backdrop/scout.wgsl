import { bayer, quantise, grain } from "./ink.wgsl";
import { cellOf, dotOf, drift } from "./glyph.wgsl";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// SCOUT — the retrieval model, drawn.
//
// Canary searches in two passes: small scout vectors sweep the corpus broadly
// and cheaply, then full vectors rerank the survivors precisely. Matryoshka
// embeddings make that possible because the coarse vector is a prefix of the
// fine one — the same representation at nested resolutions.
//
// A mip pyramid is that idea in pixels, so the corpus here is a real page of
// Ley 39/2015, set in columns and uploaded with its whole mip chain. The rings
// step through LOD toward wherever attention is: a blurred average of the page
// out at the edges, correctly filtered, screened into a coarse halftone — and
// the same type fully set at the centre. Nothing is faking text.
//
// Three states of one material, then: the corpus drifting unstructured beyond
// the reach, the page resolving through nested levels inside it, and a clearing
// where the answer goes, because there is nothing left to search there.

struct Params {
  texel: vec2f,
  focus: vec2f,  // 0..1 viewport position the rerank is centred on
  quiet: vec4f,  // x, y, w, h in viewport fractions — where the form sits
  time: f32,
  amp: f32,      // 0..1, widens the resolved region while a field holds focus
  pulse: f32,    // 0..1, decaying kick per keystroke
  glitch: f32,   // 0..1, collapses resolution on a rejected sign-in
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var page: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const LEVELS = 5.0;
// Three mips down is where a column of this type stops being readable but
// still reads as set text. Further up the chain the page is 32 texels wide and
// magnifies into meaningless blobs.
const TOP_LOD = 3.0;
const PAGE = vec2f(2048.0, 3072.0);
const SCALE = 1.36; // page pixels per device pixel: ~11px body type on screen

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // ── the corpus at rest ─────────────────────────────────────────────────
  let q = vec2f(uv.x * aspect, uv.y);
  var tide = fbmSimplex3d(vec3f(q * 2.6, params.time * 0.10), 3, 2.17, 0.5) * 0.5 + 0.5;
  tide = smoothstep(0.42, 0.96, tide);
  let ambient = quantise(tide, 4.0, bayer(vec2u(px), 3u))
    * select(0.0, 1.0, drift(cellOf(px), dotOf(px), params.time))
    * (0.105 + params.amp * 0.045);

  // ── the rerank ─────────────────────────────────────────────────────────
  let reach = (0.74 + params.amp * 0.14 + params.pulse * 0.05) * (1.0 - params.glitch * 0.45);
  let r = length((uv - params.focus) * vec2f(aspect, 1.0));

  // Nested, not a smooth ramp: the representation steps between resolutions,
  // so the picture of it should too.
  let s = clamp(1.0 - r / reach, 0.0, 1.0) * LEVELS;
  let level = floor(s) / LEVELS;

  // The page scrolls slowly under the whole thing. Repeat addressing carries
  // the wrap, so the column rules line up across the seam.
  let spot = (px * SCALE + vec2f(0.0, params.time * 22.0)) / PAGE;
  let coverage = textureSampleLevel(page, samp, spot, (1.0 - level) * TOP_LOD).r;

  // Coarse levels come back as a smooth average, so the screen has to supply
  // the texture: a chunky halftone at the edges resolving to a fine one at the
  // centre, which is also what a lower-dimensional embedding actually looks
  // like when you draw it honestly.
  let cell = mix(5.0, 1.0, level);
  let steps = mix(2.0, 8.0, level);
  // Brightness steps with the level rather than saturating early, so each ring
  // is a distinct pass and the nesting stays countable.
  let doc = quantise(coverage, steps, bayer(vec2u(px / cell), 3u))
    * select(0.0, mix(0.15, 0.62, level), level > 0.01);

  // One hairline per level boundary. fwidth keeps it a constant width on screen
  // instead of thinning out as the rings grow.
  let edge = min(fract(s), 1.0 - fract(s));
  let rings = (1.0 - smoothstep(0.0, fwidth(s) * 1.1, edge)) * 0.085 * step(0.001, level);

  // ── compose ────────────────────────────────────────────────────────────
  let taken = smoothstep(0.0, 0.55, level);
  var value = ambient * (1.0 - taken * 0.9) + doc + rings;

  // Ease proportionally to the region rather than by a fixed distance: a fixed
  // falloff wider than the region's half-width never reaches full clearing, so
  // the middle stays veiled and the edge still reads as a box.
  let k = params.quiet;
  let room = smoothstep(0.0, k.z * 0.20, min(uv.x - k.x, k.x + k.z - uv.x))
    * smoothstep(0.0, k.w * 0.14, min(uv.y - k.y, k.y + k.w - uv.y));
  value *= 1.0 - room;

  var color = vec3f(value);
  color += vec3f(grain(px, params.time) * 0.011);
  return vec4f(color, 1.0);
}
