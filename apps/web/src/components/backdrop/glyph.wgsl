import { pcg2d } from "@vgpu/wgsl-std/hash";

// Letterforms on a 3x5 dot matrix.
//
// Two readings of the same material. `mask` is the static one a set page is
// made of — a given cell always carries the same character. `drift` rehashes on
// a slow per-cell cadence and is what the ambient field is made of. Sharing the
// matrix is the point: a document can condense out of the field because both
// are built from the same letterform.

// One character cell of the ambient field, in device pixels.
export const CELL = vec2f(11.0, 18.0);

// Is dot (col, row) of this cell's matrix lit?
//
// `weight` is how much of the matrix a character fills: two decorrelated bits
// per dot give four evenly spaced coverage steps, so the same call sets body
// text and a heavier heading face without a second matrix. Half coverage reads
// as scattered dots rather than letters; three quarters is where a 3x5 cell
// starts looking like a character.
export fn mask(cell: vec2i, dot: vec2i, weight: f32) -> bool {
  if (dot.x < 0 || dot.x > 2 || dot.y < 0 || dot.y > 4) {
    return false;
  }
  let bits = pcg2d(bitcast<vec2u>(cell));
  let i = u32(dot.y * 3 + dot.x);
  let a = f32((bits.x >> i) & 1u);
  let b = f32((bits.y >> i) & 1u);
  return (a * 0.5 + b * 0.25 + 0.125) < weight;
}


// The same cell, rehashed on its own slow clock. Every cell changes on a
// different beat, so the field has life without anything sliding across it.
export fn drift(cell: vec2i, dot: vec2i, time: f32) -> bool {
  let phase = f32(pcg2d(bitcast<vec2u>(cell)).y % 997u) / 997.0;
  let tick = i32(floor(time * 0.6 + phase * 11.0));
  return mask(cell + vec2i(tick * 7919, tick * 104729), dot, 0.55);
}

// Which cell of the ambient field a device pixel falls in, and which dot.
export fn cellOf(px: vec2f) -> vec2i {
  return vec2i(floor(px / CELL));
}

export fn dotOf(px: vec2f) -> vec2i {
  return vec2i(floor(fract(px / CELL) * vec2f(4.0, 6.0)));
}
