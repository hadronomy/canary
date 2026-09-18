import { bayer, quantise, grain } from "./ink.wgsl";

// INTERFERENCE — two passes that no longer agree.
//
// Retrieval here is two readings of the same corpus, and the answer is where
// they line up. When one of them stops, what is left is the beat between them:
// broad horizontal bands that drift through each other and never settle.
//
// No noise field and no texture, just two frequencies and their difference —
// the cheapest thing on the page, because this one renders after something has
// already gone wrong.

struct Params {
  texel: vec2f,
  time: f32,
  amp: f32, // 0..1, how far the two passes have drifted apart
}

@group(0) @binding(0) var<uniform> params: Params;

const FAULT = vec3f(0.937, 0.506, 0.463); // #ef8176, the page's one hue

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = 1.0 / params.texel;
  let px = uv * res;

  // Two scan frequencies, close enough to beat slowly against each other. The
  // detuning is the whole effect: identical frequencies would just be stripes.
  let drift = 1.0 + 0.055 + params.amp * 0.05;
  let a = sin((uv.y * 26.0 + params.time * 0.55) * 6.2831853);
  let b = sin((uv.y * 26.0 * drift - params.time * 0.31) * 6.2831853 + uv.x * 0.55);

  // Their product is the beat envelope; the slow term underneath it keeps whole
  // regions dropping in and out rather than the whole field pulsing at once.
  let beat = a * b * 0.5 + 0.5;
  let hold = sin((uv.y * 3.1 - params.time * 0.09) * 6.2831853) * 0.5 + 0.5;

  // Fade to nothing at the top and bottom so the bands belong to the page
  // instead of stopping at its edges.
  let edge = smoothstep(0.0, 0.30, uv.y) * smoothstep(1.0, 0.70, uv.y);

  let energy = quantise(beat * mix(0.12, 1.0, hold) * edge, 4.0, bayer(vec2u(px), 3u));

  // Only the crests carry the hue. A fault tone spread across the whole field
  // would just be a red page; held to the peaks it registers before anything
  // has actually been read, which is the job.
  var color = mix(vec3f(1.0), FAULT, smoothstep(0.45, 1.0, energy)) * energy * 0.19;
  color += vec3f(grain(px, params.time) * 0.012);
  return vec4f(color, 1.0);
}
