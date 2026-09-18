import { cellOf, dotOf, mask } from "./glyph.wgsl";
import { bayer, quantise, grain } from "./ink.wgsl";
import { hash2 } from "@vgpu/wgsl-std/hash";

// WAKE · STRATA — the same current, read at three depths at once.
//
// `wake` sets one page of type on the flow. This sets three, stacked away from
// the viewer: each layer is a coarser screen than the one in front of it, drifts
// slower, and sits further into the dark. Depth is the reading — the corpus is
// not a surface the reference is missing from, it is a stack, and the absence
// goes all the way down.
//
// The three layers share one field, so the extra depth costs three texture
// fetches and no new solve. What sells it is that the parallax is real: each
// layer is offset along its own streamlines, so they slide past each other the
// way planes at different distances do, rather than sliding as one picture.

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

const ROWS = 520.0; // streamfunction to row pitch, front plane
const DRIFT = 26.0; // device pixels a second, downstream, front plane

/// One plane of type set on the current.
///
/// `depth` is 0 at the front and 1 at the back. Everything that makes a plane
/// read as distant is driven from it: the screen coarsens, the drift slows, the
/// ink drops away, and the letterforms lose their weight until the furthest
/// plane is texture rather than text — which is what distance does to a page you
/// can still see but can no longer read.
fn plane(px: vec2f, psi: f32, density: f32, time: f32, depth: f32) -> f32 {
  // Further is smaller, the way distance actually works. Coarsening the back
  // planes instead reads as damage rather than as depth — big blocky characters
  // look like a broken screen, not like a page further away.
  let scale = mix(1.0, 0.58, depth);
  let speed = mix(1.0, 0.34, depth);
  let seed = 7.0 + depth * 53.0;

  let spot = vec2f(px.x - time * DRIFT * speed, psi * ROWS) / scale;
  let cell = cellOf(spot);

  // Each plane thins as it recedes, so the front page still reads as the page
  // and the ones behind it read as what is behind it.
  let alive = density * mix(1.0, 0.44, depth);

  // Density, not brightness: a glyph is either set or it is not. Fading whole
  // letterforms to grey is what makes a stack like this read as haze.
  let here = hash2(vec2f(cell) + seed).x < alive;
  let lit = here && mask(cell, dotOf(spot), mix(0.68, 0.74, depth));

  let heavy = hash2(vec2f(cell) + seed + 12.0).y < alive * 0.5;
  return select(0.0, select(mix(0.30, 0.07, depth), mix(0.56, 0.12, depth), heavy), lit);
}

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

  // One slow breath so a field solved once is not a frozen one.
  let alive = density * (0.88 + 0.12 * sin(params.time * 0.25 + psi * 1.4));

  // Sampled off the same streamfunction at three offsets. The offset is what
  // separates the planes: without it all three set the same characters in the
  // same places and the stack collapses into one slightly noisier page.
  let near = plane(px, psi, alive, params.time, 0.0);
  let mid = plane(px, psi + 0.031, alive, params.time, 0.5);
  let far = plane(px, psi + 0.067, alive, params.time, 1.0);

  // Painted back to front. `max` rather than a sum, because two planes agreeing
  // on a pixel means the near one is in front of the far one — not that the ink
  // is twice as dark there.
  var value = max(near, max(mid, far));

  // The furthest plane is near enough to the noise floor to band on an 8-bit
  // display, so the composite goes through an ordered dither on its way out.
  value = quantise(value, 12.0, bayer(vec2u(px), 3u));

  value += grain(px, params.time) * 0.012;
  return vec4f(vec3f(max(value, 0.0)), 1.0);
}
