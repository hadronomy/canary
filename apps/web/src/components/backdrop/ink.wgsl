import { hash2 } from "@vgpu/wgsl-std/hash";

// Ordered-dither and film-stock helpers shared by the three login backdrops.
// Every large tonal ramp on those pages goes through `quantise` so it lands as
// texture instead of an 8-bit band.

// Bayer threshold in [0, 1) for a 2^levels square matrix.
//
// Built from the recursive definition M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]: the
// coarsest split contributes the *low* bits, which is why the shift runs from
// the most significant bit of the cell coordinate down. Verified against the
// canonical 4x4 matrix.
export fn bayer(cell: vec2u, levels: u32) -> f32 {
  var v = 0u;
  for (var i = 0u; i < levels; i = i + 1u) {
    let b = levels - 1u - i;
    let xi = (cell.x >> b) & 1u;
    let yi = (cell.y >> b) & 1u;
    v = v | ((((xi ^ yi) << 1u) | yi) << (2u * i));
  }
  return f32(v) / f32(1u << (2u * levels));
}

// Snap `value` to `steps` levels, nudged by a dither threshold first.
//
// The nudge is the whole trick: it pushes each pixel to whichever side of a
// step its threshold selects, so neighbouring pixels straddle the boundary and
// the eye reconstructs the ramp. Quantising without it just draws the bands.
export fn quantise(value: f32, steps: f32, threshold: f32) -> f32 {
  return floor((value + (threshold - 0.5) / steps) * steps + 0.5) / steps;
}

// Per-pixel film grain in [-0.5, 0.5], reseeded every frame.
export fn grain(px: vec2f, time: f32) -> f32 {
  return hash2(px + vec2f(time * 71.3, time * 37.9)).x - 0.5;
}

// Two-ink duotone. `t` picks along the ramp, `lift` keeps the shadows off pure
// black so the paper still reads as paper.
export fn duotone(dark: vec3f, light: vec3f, t: f32, lift: f32) -> vec3f {
  return mix(dark, light, clamp(t, 0.0, 1.0)) + dark * lift;
}
