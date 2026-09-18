import { hash2 } from "@vgpu/wgsl-std/hash";

// WEAVE — the second static pass.
//
// Line integral convolution over the precomputed velocity field, plus the
// density the glyphs will be thresholded against. All of it is a function of the
// field, which is a function of position, so this runs once alongside it.
//
// Output: xy = flow direction, z = density, w = streamfunction.

struct Params {
  texel: vec2f,
  body: vec2f,   // half-width and half-height of the block, flow units
  centre: vec2f, // 0..1 position of the block within the section
  time: f32,
  amp: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const SPAN = 2.4;
const STEPS = 8;

fn toUv(z: vec2f, aspect: f32, centre: vec2f) -> vec2f {
  return vec2f(z.x / (aspect * SPAN) + centre.x, z.y / SPAN + centre.y);
}

/// The field the convolution smears. Interpolated rather than per-cell: a hard
/// lattice smeared along a curve reads as a crosshatch of the lattice, not as a
/// streak of the flow.
fn seed(q: vec2f) -> f32 {
  let p = q * 20.0;
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i).x;
  let b = hash2(i + vec2f(1.0, 0.0)).x;
  let c = hash2(i + vec2f(0.0, 1.0)).x;
  let d = hash2(i + vec2f(1.0, 1.0)).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let aspect = res.x / res.y;
  let z = vec2f((uv.x - params.centre.x) * aspect, uv.y - params.centre.y) * SPAN;

  let here = textureSampleLevel(field, samp, uv, 0.0);
  let v = here.xy;
  let psi = here.z;
  let out = here.w;
  let speed = length(v);

  var acc = 0.0;
  var sum = 0.0;
  var q = z;
  for (var i = 0; i < STEPS; i = i + 1) {
    let s = textureSampleLevel(field, samp, toUv(q, aspect, params.centre), 0.0);
    q = q - (s.xy / max(length(s.xy), 1e-4)) * 0.055;
    let k = 1.0 - f32(i) / f32(STEPS);
    acc = acc + seed(q) * k;
    sum = sum + k;
  }

  // Wide, because a jet spans a far greater range of speeds than a uniform
  // stream does. Too narrow a window saturates across the whole core and the
  // concentration stops being visible at all.
  let pressure = smoothstep(0.30, 3.0, speed);

  // Slow water carries almost no text; fast water carries all of it. This is
  // what cuts the jet out of the field rather than merely brightening part of it.
  let lume = mix(0.14, 1.18, pressure);
  let band = smoothstep(0.30, 0.66, acc / sum);

  // Nothing is there, so nothing is drawn there. Negative `out` marks the
  // interior, where the inversion has no answer.
  let clear = select(0.0, smoothstep(0.0, 0.055, out), out >= 0.0);

  // Vertical air top and bottom, and a short fade at the inlet so the jet
  // arrives rather than starting as a wall against the left edge.
  let air = smoothstep(0.0, 0.34, uv.y) * smoothstep(1.0, 0.66, uv.y)
    * smoothstep(0.0, 0.11, uv.x) * smoothstep(1.0, 0.94, uv.x);

  let lift = 0.55 + params.amp * 0.45;
  let density = clamp(band * lume * 3.0, 0.0, 1.0) * clear * air * lift;

  return vec4f(v / max(speed, 1e-4), density, psi);
}
