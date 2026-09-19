// A luminance ramp drawn as characters on a 3x5 dot matrix.
//
// Ordinary dithering scatters pixels to fake the levels between two tones. This
// does the same job with letterforms: each cell picks the character whose ink
// coverage is closest to the value there, so a smooth field comes back as type.
// It is the same 3x5 matrix `glyph.wgsl` sets its field on, so the two read as
// the same material at different resolutions.
//
// The ramp is ordered by coverage and nothing else. A character that breaks the
// ordering puts a dark cell inside a light run and reads as a speck of dirt.

export const ASCII_LEVELS = 10u;

/// One character cell, derived from the surface rather than fixed.
///
/// A constant in device pixels halves the type on a 2x display, which is how
/// the field went from set text to a faint speckle on exactly the machines it
/// was being judged on. Sizing from the width instead keeps roughly the same
/// number of columns on screen everywhere. The 3x5 matrix sits inside a 4x6 dot
/// grid, so the spare column and row are the gutter that keeps neighbouring
/// cells from fusing into a texture.
export fn asciiCellSize(res: vec2f) -> vec2f {
  let w = max(10.0, floor(res.x / 132.0));
  return vec2f(w, floor(w * 1.5));
}

// Row-major, three bits per row, five rows: bit (row * 3 + col).
//   ' '  '.'  ':'  '-'  '+'  '='  '%'  '*'  '#'  '@'
var<private> RAMP: array<u32, 10> = array<u32, 10>(
  0x0000u, // blank
  0x2000u, // .
  0x0410u, // :
  0x01C0u, // -
  0x05D0u, // +
  0x0E38u, // =
  0x52A5u, // %
  0x55D5u, // *
  0x5F7Du, // #
  0x73CFu, // @
);

/// Which cell a device pixel falls in.
export fn asciiCell(px: vec2f, cellSize: vec2f) -> vec2f {
  return floor(px / cellSize);
}

/// The centre of that cell, in device pixels.
///
/// The field is sampled here rather than at the pixel: one value per cell is
/// what makes the output a character instead of a character-shaped hole punched
/// out of a gradient.
export fn asciiCentre(cell: vec2f, cellSize: vec2f) -> vec2f {
  return (cell + 0.5) * cellSize;
}

/// Which dot of the matrix this pixel is, within its cell.
export fn asciiDot(px: vec2f, cellSize: vec2f) -> vec2i {
  return vec2i(floor(fract(px / cellSize) * vec2f(4.0, 6.0)));
}

/// Is this dot lit for a cell holding `value` in [0, 1]?
///
/// `dither` shifts the level by up to half a step before rounding, so cells
/// either side of a boundary land on different characters and the ramp reads as
/// continuous instead of as nine visible terraces.
export fn ascii(px: vec2f, cellSize: vec2f, value: f32, dither: f32) -> f32 {
  let dot = asciiDot(px, cellSize);

  // The gutter column and row.
  if (dot.x > 2 || dot.y > 4) {
    return 0.0;
  }

  let steps = f32(ASCII_LEVELS - 1u);
  let level = u32(clamp(floor(value * steps + dither), 0.0, steps));
  let bits = RAMP[level];

  return f32((bits >> u32(dot.y * 3 + dot.x)) & 1u);
}
