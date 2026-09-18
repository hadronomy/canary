import { bayer, quantise, grain } from "./ink.wgsl";
import { hash2 } from "@vgpu/wgsl-std/hash";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

// VOID — a result set with a hole in it.
//
// The sign-in page resolves toward its centre: the rerank narrows and the
// answer arrives. This is that gesture run backwards. Citation rows fill the
// field and then thin out to nothing where the answer should be, because the
// reference that was asked for does not resolve to anything.
//
// Deliberately cheap — a grid, a hash and one noise call. No textures, no mip
// chain, nothing to upload. A page that exists to explain a failure should not
// be able to fail in a second, more expensive way.

struct Params {
  texel: vec2f,
  time: f32,
  amp: f32,  // 0..1, opens the void wider on pointer proximity
}

@group(0) @binding(0) var<uniform> params: Params;

const ROW = vec2f(78.0, 22.0); // one citation row, device pixels

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;
  let aspect = res.x / res.y;

  // Rows drift sideways at their own speeds, the way a list settles.
  let row = floor(px.y / ROW.y);
  let lane = hash2(vec2f(row, 3.1)).x;
  let slide = params.time * (6.0 + lane * 10.0) * select(-1.0, 1.0, lane > 0.5);
  let cell = vec2f(floor((px.x + slide) / ROW.x), row);
  let within = fract((px.x + slide) / ROW.x);

  // Each row is a short rule of its own length, with its own gap — a list of
  // references rather than a texture of marks.
  let mark = hash2(cell + 17.0);
  let run = 0.22 + mark.x * 0.62;
  let down = px.y - row * ROW.y;
  let tick = step(within, run) * step(9.0, down) * step(down, 11.0);

  // The hole. Nothing survives inside it, and the field only reaches full
  // density well outside — the absence has to read as the subject.
  let r = length((uv - 0.5) * vec2f(aspect, 1.0));
  let open = 0.26 + params.amp * 0.05;
  let present = smoothstep(open, open + 0.34, r);

  // A hairline at the edge of the hole, so it reads as a boundary rather than
  // as the field simply running out of ink.
  let rim = (1.0 - smoothstep(0.0, fwidth(r) * 1.6, abs(r - open))) * 0.30;

  // Slow breathing across the field so the page is never entirely still.
  let tide = fbmSimplex3d(vec3f(uv * 2.2, params.time * 0.06), 2, 2.17, 0.5) * 0.5 + 0.5;

  let energy = quantise(tick * present * mix(0.35, 1.0, tide), 3.0, bayer(vec2u(px), 2u));
  var color = vec3f(energy * 0.24 + rim);
  color += vec3f(grain(px, params.time) * 0.010);
  return vec4f(color, 1.0);
}
