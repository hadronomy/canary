import { cellOf, dotOf, mask } from "./glyph.wgsl";
import { hash2 } from "@vgpu/wgsl-std/hash";

// WAKE — the corpus flowing past something that is not there.
//
// The absence is the text block, and nothing is drawn around it. You know where
// it is because the current tells you: the stream is funnelled into a narrow
// fast band on the left, rams into the leading face and stalls there, races
// around the shoulders, and opens out again downstream.
//
// Everything expensive about that — the conformal pullback onto the squircle,
// the jet, the convolution — depends only on where the block is, so it is solved
// once into a texture by `field` and `weave`. All that is left here is a fetch
// and a letterform, which is what lets this run on a phone.
//
// The text is set on the current's own coordinates rather than on the screen's:
// rows are streamlines, so a line of type bends exactly the way the water does,
// and the whole page drifts downstream one row at a time.

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

const ROWS = 520.0; // streamfunction to row pitch
const DRIFT = 26.0; // device pixels a second, downstream

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;

  let f = textureSampleLevel(weave, samp, uv, 0.0);
  let density = f.z;
  let psi = f.w;

  if (density <= 0.001) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  // Rows follow the streamfunction, so they crowd where the current accelerates
  // and open where it slows — the type spaces itself the way the water does.
  let spot = vec2f(px.x - params.time * DRIFT, psi * ROWS);
  let cell = cellOf(spot);

  // One slow breath so a field solved once is not a frozen one.
  let alive = density * (0.88 + 0.12 * sin(params.time * 0.25 + psi * 1.4));

  // Density, not brightness. A field where every glyph is a dim smear reads as
  // grime; one where each glyph is crisp and only some are present reads as
  // text — and lets the troughs reach true black instead of hazing to grey.
  let here = hash2(vec2f(cell) + 7.0).x < alive;
  let lit = here && mask(cell, dotOf(spot), 0.68);

  // Two ink weights rather than a ramp. A printed page has a couple of densities
  // on it, not a gradient.
  let heavy = hash2(vec2f(cell) + 19.0).y < alive * 0.5;
  return vec4f(vec3f(select(0.0, select(0.30, 0.56, heavy), lit)), 1.0);
}
